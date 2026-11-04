# Application approval — three implementations exist, know which is current

`routes/index.js` mounts **both** `application.routes.js` and `applications.routes.js` at the same
`/applications` prefix. There are effectively three approve code paths:

1. **`PUT /applications/status/:applicationId`** → `controllers/application.controller.js`'s
   `approveApplication` — an older, simpler path. It does **not** run duplicate-review gating and
   never creates a `Profile` unless one already exists. Treat this as legacy; don't extend it.
2. **`POST /applications/:applicationId/approve`** → `controllers/profileApproval.controller.js`'s
   `approveApplication` — **this is the real, current pipeline.** Retries on Mongo
   `TransientTransactionError` (up to 3x), applies a reviewer patch (overlay or inline), enforces
   `ensureDuplicateReviewAllowsApproval()` (throws `DUPLICATE_REVIEW_REQUIRED` unless duplicate status
   is one of `NO_MATCH/LINKED/MERGED/MARKED_NEW/IGNORED`), captures payment, resolves/creates/
   links/merges the `Profile` via `resolveProfileForApproval()`, writes the three staging collections,
   commits the transaction, then calls `publishPostApprovalEvents()`.
3. **`controllers/bulkApproval.controller.js`** — a **third, largely copy-pasted reimplementation** of
   (2)'s steps, one transaction per application, kept in sync by hand. A fix to the approval flow made
   in `profileApproval.controller.js` needs a matching fix here — nothing enforces they stay
   identical, so check both files whenever changing approval logic.

**Dead code, don't build on it**: `services/approval.service.js` and `helpers/approval.helpers.js` are
unused (only referenced by the standalone `debug-approve-reject.js` script).
`controllers/applications.controller.js`'s `getApplicationForm`/`saveReviewDraft` (built on
`helpers/overlay.helpers.js`) are not wired into any route — `controllers/overlay.controller.js`'s
`saveOverlayDraft` (`POST /applications/:applicationId/review-draft`) is the one actually used. A
`ReviewOverlay` (`models/reviewOverlay.model.js`) is a staged RFC-6902 JSON Patch a reviewer prepares
before approving — it's unrelated to duplicate-review matching, just an alternate way to feed edits
into step (2)'s approve call (`overlayId` vs. an inline `submission`/`proposedPatch`).

**Executive Council approval** (`controllers/executiveCouncilApproval.controller.js`) is a separate,
later marker step — only valid once `applicationStatus === PROCESSED`, publishes
`applications.executive-council.approved.v1`/`.rejected.v1`, and never touches `Profile`/subscription
data itself.

## Post-approval publish (`services/publishPostApprovalEvents.js`)

Called after the transaction commits, each publish independently try/caught:
`applications.review.processed.v1` (portal-service + user-service role upgrade),
`members.member.created.requested.v1` (subscription-service creates the membership),
`members.gap-letter.requested.v1` (conditional), `members.subscription.upsert.requested.v1`.

**A publish failure here never rolls back the already-committed approval.** This is a known, accepted
at-least-once/best-effort boundary — if you're asked to make it more consistent, the fix is a
retry/outbox mechanism around the publish calls, not wrapping the publish back into the DB
transaction.

## P5 decision guards (all decision paths)

Every decision path (single approve/reject, bulk approval, legacy `PUT /applications/status/:id`,
`POST /:applicationId/duplicate-review`) now shares the same guards — change them together:

- **Preconditions** (`services/decisionPreconditions.js`): `DUPLICATE_REVIEW_VERSION_MODE` =
  `compat` (default; anything other than exactly `enforce`) | `enforce`. Enforce requires an
  `Idempotency-Key` header (428 `IDEMPOTENCY_KEY_REQUIRED`) and `expectedReviewVersion` (428
  `REVIEW_VERSION_REQUIRED`) on approve, bulk rows (`items[]`), legacy approve and the review
  decision; reject needs only the key. Malformed values are 400 in both modes; a sent version is
  always checked (409 `REVIEW_VERSION_CONFLICT`). Compat omissions log
  `[decision-preconditions] compatibility window`.
- **Version lock**: duplicate gate before the claim; claim records `paymentDecision.reviewVersion`;
  inside the transaction the review is re-checked and locked at that version before any capture.
  Bulk does this per row (`bulkApproveOne`), with its own claim/lease/transaction, and aborts the
  row's transaction on any failure (it used to commit partial work).
- **Ownership**: `assertReviewedProfileTarget` before capture (LINK/MERGE target = same-tenant,
  current unignored match: 404 `MATCHED_PROFILE_NOT_FOUND` / 409 `MATCH_NOT_CURRENT`; Create New:
  409 `PROFILE_EMAIL_EXISTS`); `assertApprovalPaymentBinding` before capture/cancel (409
  `PAYMENT_BINDING_MISSING` / `PAYMENT_APPLICATION_MISMATCH`). Bulk now resolves LINKED/MERGED
  reviews through `resolveProfileForApproval` like single approval.
- **Replay**: a run's `Idempotency-Key` is stored on the claim (`paymentDecision.operationKeys`);
  the same key after completion replays the outcome (`replayed: true`) instead of 409.
- Tests: `tests/duplicateReviewOwnership.p5.test.js`, `tests/duplicateReviewRace.p5.test.js`
  (real replica set, `P5_DUPREVIEW_MONGO_URI`), `tests/decisionPreconditions.p5.test.js`.

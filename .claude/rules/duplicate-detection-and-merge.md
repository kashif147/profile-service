# Duplicate detection & merge

`services/duplicate.matching.js` scores candidates: exact match (email/mobile/NMBI/previous
membership no/payroll no) = 100; fuzzy match is weighted (DOB 35, surname 25, eircode 20, forename 10,
address 10), surfaced at ≥40. `services/duplicate.review.service.js` drives the reviewer decision
(`MARKED_NEW`/`LINK`/`MERGE` for applications — **`IGNORE_MATCH` is explicitly rejected** for
application-level review, unlike profile-to-profile merge where ignoring is allowed). Once an
application is `PROCESSED`, its duplicate review locks
(`assertApplicationDuplicateReviewMutable()`) — further duplicate handling has to happen from the
`Profile` side instead.

## Merge is transactional locally, but not across services

`duplicate.merge.service.js`'s `executeProfileDuplicateMerge` runs in a Mongo transaction (reassigns
`PersonalDetails`/`MemberPaymentForm`/`TransferRequest`/`Batch` references from the absorbed profile
to the master via `profile.merge.consolidation.service.js`), but **after that transaction commits**,
it makes separate, non-transactional HTTP calls to subscription-service and account-service to
reassign subscriptions and finance records. If either remote call fails, the local merge is already
permanent — there is no rollback. Any new cross-service reassignment call added to this flow inherits
the same no-rollback risk: design it to be safely retryable/idempotent on its own, don't assume the
whole merge can be re-run if a downstream call fails partway through.

`resolveProfileForDuplicateMerge()` requires the target profile to already appear in
`PersonalDetails.duplicateReview.matchSummary` as an unignored match — you can't merge/link an
arbitrary `profileId` outside that recorded match, except internally at approval time, where
`requireAuthorizedMatch: false` is used because the review decision already validated it.

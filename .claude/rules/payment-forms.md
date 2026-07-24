# Payment forms

`models/memberPaymentForm.model.js` backs three form types tied to a member's subscription
`paymentType`: `STANDING_ORDER` (SBO), `SALARY_DEDUCTION` (SD19 — same SD19 that
`notification-service` independently prefills at application-approval time, see that service's
`CLAUDE.md`; these are two different mechanisms for a related need, not the same code path), and
`DD_MANDATE` (SEPA). See `docs/PAYMENT_FORMS_API.md` for the full route table — it's accurate.

**`services/paymentFormPdf/` is this service's own copy of the SBO/SD19 template-drawing code**
(`membershipFormPdf.js`, `sd19LayoutDetect.js`, `membershipFormFinancials.js`, plus
`services/config/membershipFormLayout.js` and the two source PDF assets under
`services/assets/membership-forms/`). This used to be a relative-path `require` reaching into
`notification-service`'s source tree, which only worked in a local monorepo checkout and threw
`"Payment form PDF templates are not configured on this server"` in any real container deployment
(each service's `Dockerfile` only copies its own repo) — it's now a real, working local copy
instead, verified to produce byte-identical output to notification-service's original for the same
input. `notification-service/services/membershipFormFinancials.js` also duplicates a small static
fee table from subscription-service for the same reason (own `CLAUDE.md`) — if subscription-service's
`MEMBERSHIP_FEE_EUR_BY_KEY` table changes, update all three copies
(subscription-service/notification-service/profile-service). `services/config/logger.js` here is a
minimal shim (not a real pino instance, unlike notification-service's copy) since this service
doesn't otherwise use pino — see that file's own comment before assuming it has pino's full API.

A new relative path literal reaching into another service's directory is mechanically blocked by
`.claude/hooks/enforce-hard-rules.mjs` (root-level `PreToolUse` hook, when working from the full
`projectShell` checkout) — don't reintroduce this pattern for a future template update instead of
updating the local copy.

IBAN/BIC are encrypted at rest (`helpers/paymentFormCrypto.js`, AES-256-GCM,
`PAYMENT_FORM_ENCRYPTION_KEY`) and only decrypted for authenticated CRM reads or account-service's
direct-debit prepare call. Approving a form auto-supersedes any other active form for the same
profile, syncs `paymentType` onto the subscription via a best-effort HTTP call to
subscription-service, and publishes `members.payment-form.approved.v1` for notification-service.

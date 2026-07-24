# Misc gotchas

- `middlewares/idempotency.js` is explicitly **not production-ready** (its own comment says so): an
  in-memory `Map`, per-process, lost on restart, doesn't work across multiple instances. It's wired
  into six routes in `routes/applications.routes.js` regardless — don't assume it provides real
  idempotency guarantees at scale.
- `Profile.renewalBatchId` references a `YearEndBatch` model that doesn't exist anywhere in this
  repo — a dangling ref field, not a bug to chase down, just don't expect `.populate()` on it to work.
- `controllers/transfer.request.controller.js`'s approval path resolves work-location/branch/region
  names via an HTTP call to `${POLICY_SERVICE_URL}/api/lookup/:id/hierarchy` — despite the env var
  name, this is a lookup-service endpoint (hosted by user-service), not policy evaluation. Several
  blocks that would sync `ProfessionalDetails` and publish a work-location-updated event are commented
  out in that file — only `Profile.professionalDetails` gets updated on transfer approval today; if
  asked to make transfer approval also update `ProfessionalDetails`, that commented-out code is the
  starting point.

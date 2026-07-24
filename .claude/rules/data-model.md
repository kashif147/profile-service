# Data model: staging collections vs. the canonical Profile

`models/{personal,professional,subscription}.details.model.js` mirror portal-service's own
same-named collections (shared `applicationId`, staging data for an in-flight application — see
portal-service's `CLAUDE.md`). `models/profile.model.js` (`Profile`) is the **separate, authoritative
post-approval member record** — it is not the same document as the staging collections, and it gets
created/linked/merged only during application approval (see `application-approval.md`). `Profile`
has an audit-on-save hook (`ProfileSchema.post("save")` → `profile.audit.publisher.js`) that publishes
every create/update for audit-service/reporting-service consumption automatically — don't publish a
separate audit event when mutating a `Profile` document directly, the hook already does it.

## Cross-tenant gap: no query-level tenant-scoping middleware

`Profile` has no automatic tenant filter — isolation is enforced only by each controller remembering
to filter by `tenantId` manually. Two confirmed gaps where this was missed:
`controllers/corn.market.controller.js` and `controllers/recruit.a.friend.controller.js` both query
`Profile` with no `tenantId` filter at all — a real cross-tenant data leak. Fix these (or any new
`Profile` query) the way `controllers/universal.search.controller.js` already does it correctly
(`query.tenantId = req.tenantId`) — use that controller as the reference pattern, not the other two.

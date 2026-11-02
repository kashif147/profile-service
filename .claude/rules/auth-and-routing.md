# Auth and the double route mount

`middlewares/auth.js` implements the platform-standard identity pattern: gateway-verified JWT
(`x-jwt-verified: true` + `x-auth-source: gateway`, identity read from `x-user-*` headers) with a
legacy `Authorization: Bearer <jwt>` fallback verified against `JWT_SECRET`. Authorization is a
separate step via `defaultPolicyMiddleware.requirePermission(resource, action)`, calling out to
user-service's `/policy/evaluate`. Outbound calls to other services (subscription-service,
account-service, notification-service, etc.) must forward the original caller's
`Authorization`/gateway headers rather than use a shared API key — see the `cross-service-auth`
skill. When working from the full `projectShell` checkout, this is additionally mechanically
enforced by `.claude/hooks/enforce-hard-rules.mjs` (root-level `PreToolUse` hook on `Write`/`Edit`),
which blocks the literal header key `x-api-key` and any new `<PREFIX>_API_KEY` env var outside a
known external-provider allowlist.

## The real gotcha: `routes/profile.routes.js` is mounted twice

Once directly at `/api/profile` in `app.js` *before* the global `app.use(authenticate)`, and again
indirectly through `/api` → `routes/index.js` → `/profile`. Because Express matches the first
registration, all `/api/profile/*` traffic is actually handled by the pre-`authenticate` mount — that
router enforces its own auth internally (`router.use(authenticate)` partway through the file, after
intentionally unauthenticated internal/service-to-service routes).

If you add a new route to `profile.routes.js`, check where in that file it lands relative to the
internal `authenticate` call — don't assume `app.js`'s global middleware covers it just because it
"should."

## Portal object authorization (P5) — `middlewares/memberAccess.js`

A permission code never means "every member object of the tenant": portal MEMBER / NON-MEMBER roles
carry `profile:*`, `portal:*`, `application:*` and `payments:*`. Member-data routes therefore decide on
the verified caller type first:

- **CRM staff** (`userType` CRM): `requireCrm(resource, action)` = CRM caller + the existing PDP
  permission. Profile list/search/grid/check-email/corn-market (`profile:read`), delete and
  duplicate merge (`profile:delete`), duplicate tooling, application approve/reject/bulk/executive
  council/review/duplicate tooling and the legacy `PUT /applications/status/:id`
  (`application:write`/`read`), and every non-`/portal` payment-form route (`payments:read`/`write`).
- **Portal member**: own objects only, from the verified user id via the synced User → Profile.userId
  binding (`resolveOwnProfile`, no email/membership-number matching). `GET/PUT /profile/:profileId`
  and `/payment-forms/prefill?profileId=` require the caller's own profile; the lookup routes
  (`/profile/batch`, `/profile/internal/by-user-ids`, `/batch-lookup`, `/lookup-by-membership`) accept a
  portal caller only when every requested key is its own. Portal DELETE of a profile is not a product
  flow and is CRM-only. `/payment-forms/portal/*` is PORTAL-only and the service asserts the form
  belongs to the caller's own profile (`assertPortalOwnsForm`); portal responses never include
  plaintext IBAN/BIC.
- **Internal** (`x-internal-request`, no user identity) is unchanged on the pre-auth routes.

Denials: 403 `CRM_ONLY`, `NOT_OWNER` or `PORTAL_ONLY`; a portal caller gets the same 403 for another
member's, another tenant's or a missing object. Tests: `tests/portalObjectAuthz.p5.test.js`,
`tests/paymentFormPortalOwnership.p5.test.js`.

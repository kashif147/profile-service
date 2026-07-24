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

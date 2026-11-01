# CLAUDE.md

## What this service is

`profile-service` is the canonical hub for member data in the platform: it holds the staging
collections for in-flight membership applications, the approval/duplicate-detection pipeline that
turns an application into a member `Profile`, the authoritative `Profile` record itself, and several
adjacent CRM subsystems (payment mandate forms, transfer requests, recruit-a-friend, universal
search). Port `4001`. CommonJS throughout. No lint step (`npm run lint` is a stub).

Docs here are pervasively stale — see `docs-triage.md` before trusting any doc over the code. The
other thing most worth knowing up front: `routes/profile.routes.js` is mounted twice in `app.js`, and
the pre-`authenticate` mount is the one that actually wins (`auth-and-routing.md`).

## Commands

```bash
npm start                 # node bin/profile-service.js
npm run dev                # nodemon
npm test                   # jest (all tests, tests/**/*.test.js)
npm test -- <pattern>      # filter by file/name
npm run test:watch
npm run test:coverage
npm run migrate:batch-status              # scripts/add-status-to-batches.js
```

## Grid "Save View" system defaults
Tenant-owned only: one active system default per tenant and template type, inserted (never
overwritten) by explicit-tenant, insert-only tooling. The tenantless/`--force` seed paths
(`seed-grid-system-default-template.js`, the root `seed-grid-system-defaults.cjs` npm alias,
`seed-system-default-template.js`, and `reset-templates-and-seed-system-default.js`, which
deleted every tenant's templates) are retired; `tests/templateSeedGuard.test.js` keeps them out.

## Which docs are actually worth reading
@.claude/rules/docs-triage.md

## Data model: staging collections vs. the canonical Profile
@.claude/rules/data-model.md

## Application approval — three implementations exist
@.claude/rules/application-approval.md

## Duplicate detection & merge
@.claude/rules/duplicate-detection-and-merge.md

## Payment forms
@.claude/rules/payment-forms.md

## RabbitMQ
@.claude/rules/rabbitmq.md

## Auth and the double route mount
@.claude/rules/auth-and-routing.md

## Misc gotchas
@.claude/rules/misc-gotchas.md

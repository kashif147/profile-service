# Docs are stale here — verify against code, not docs

This is worth calling out explicitly because it's pervasive in this repo:

- `README.md` describes things that don't exist: `.env.development.template`/`.env.staging.template`
  (only a real `.env.staging` exists), a `GET /metrics` endpoint (there isn't one — only `/health` and
  `/api`), and `.github/workflows/ci-cd.yml`/`docker.yml` (the actual workflows are `azure-deploy.yml`
  — legacy Azure Web App path, not the live one — and `deploy.yml`, the real rsync-to-VM deploy on
  push to `gateway`, same pattern as every other service in this platform).
- **`BATCH_DETAILS_API.md`, `BATCH_PROCESS_FLOW.md`, `BATCH_PROCESS_ASYNC_FRONTEND.md` describe a
  payment-batch-import feature that does not exist in this codebase** (`POST /api/batch-details`,
  chunked RabbitMQ processing to account-service, `services/batch.process.job.service.js` — none of
  these files/routes exist). The actual `controllers/batch.controller.js` /
  `models/batch.model.js` / `routes/batch.routes.js` implement a completely different concept: a
  **marketing/reporting cohort snapshot** (`type: "inmo-rewards" | "new-graduate" |
  "recruit-friend"`) of `Profile` field snapshots for export, with no payment processing involved at
  all. Don't follow those three docs' API shapes or file references.
- `rabbitMQ/EXCHANGE_QUEUE_CONFIG.md` only documents 3 of the 4 consumer queues and omits several
  publishers (payment-form events, duplicate-review audit events, profile-duplicate events) — treat
  `rabbitMQ/index.js` and `rabbitMQ/events/*.js` as the source of truth instead, or `rabbitmq.md`.
- `USER_ID_LINKING_LOGIC.md` is a 0-byte empty file.
- `docs/PAYMENT_FORMS_API.md` and `docs/RECRUIT-A-FRIEND-RECRUITMENT-DETAILS.md` **are** accurate and
  current — safe to rely on. `PAYMENT_FREQUENCY_RULE.md` here is the same rule documented in
  portal-service's `CLAUDE.md` (Credit Card → Annually, everything else → Monthly).

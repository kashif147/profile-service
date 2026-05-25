# Payment forms API (profile-service)

Base path: `/api/payment-forms` (requires authentication).

## CRM

| Method | Path | Description |
|--------|------|-------------|
| `PUT` | `/filter` | List/filter payment forms (`paymentForms`, pagination). Body `purpose: "direct-debit-prepare"` + `profileIds[]` returns `{ mandates }` for account-service DD prepare. |
| `POST` | `/direct-debit/mandates-for-prepare` | Active authorized DD mandates with decrypted IBAN/BIC for DD run prepare (`profileIds[]` → `{ mandates }`) |
| `GET` | `/prefill?profileId=&formType=` | Hydrated preview (not stored) |
| `POST` | `/` | Save new form (`profileId`, `formType`, optional field body); status `draft` |
| `GET` | `/profile/:profileId` | List forms for member Documents tab |
| `GET` | `/:id` | Get one (includes sensitive fields for CRM) |
| `PATCH` | `/:id` | Update debtor/creditor fields |
| `POST` | `/:id/submit` | Mark submitted (records client IP). Standing order requires `standingOrder.startDate`. |
| `POST` | `/:id/verify` | Mark verified |
| `POST` | `/:id/approve` | Approve, update subscription, notify member |
| `POST` | `/:id/reject` | Reject |
| `POST` | `/:id/upload-paper` | Multipart `file` – paper scan |
| `POST` | `/:id/upload-signed` | Multipart `file` – signed PDF |
| `POST` | `/:id/send-email` | Queue email manually (CRM automation uses approve instead) |

On **approve**, profile-service publishes `members.payment-form.approved.v1` for portal/mobile push (all form types, requires member `userId` on profile). Email options are recorded when the profile has an address; push is not gated on email.

### `formType` values

- `STANDING_ORDER` – SBO 7475
- `SALARY_DEDUCTION` – SD19
- `DD_MANDATE` – SEPA direct debit

## Portal (`/api/payment-forms/portal`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/mine` | List member's visible forms |
| `POST` | `/` | Create draft (`formType`) |
| `GET` | `/:id` | Get (masked IBAN) |
| `PATCH` | `/:id` | Update editable fields |
| `POST` | `/:id/submit` | Electronic submit (IP logged). Standing order requires `standingOrder.startDate`. |
| `POST` | `/:id/upload-signed` | Upload signed PDF |
| `POST` | `/:id/upload-signature` | Upload drawn signature image (optional); PNG/JPEG multipart or JSON `imageBase64` |

## Environment

- `USER_SERVICE_URL` / `POLICY_SERVICE_URL` – tenant branding & organisation profile
- `SUBSCRIPTION_SERVICE_URL` – current subscription & fee frequency
- `AZURE_STORAGE_*` – PDF/blob storage
- `PAYMENT_FORM_ENCRYPTION_KEY` – AES-256-GCM for IBAN/BIC at rest (recommended in production)
- `PAYMENT_FORM_RETENTION_YEARS` – default `6`

## Events

- `members.payment-form.approved.v1` → notification-service (member push + portal visibility)
- `members.member.notification.requested.v1` – optional email from CRM

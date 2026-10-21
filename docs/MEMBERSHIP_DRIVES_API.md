# Membership Drives API

Recruitment drives run by staff (IRO / branch / region officers) from MembersHub. Base path
`/api/membership-drives` (behind the gateway: `/profile-service/api/membership-drives`).
Policy resource `membership-drives` (`read` / `write`); CRM staff users only.

Tenant and acting user always come from the trusted context (gateway headers or verified
JWT). A `tenantId`, `ownerUserId`, `status` or any other unknown key in a request body is a
`400`. A drive in another tenant is a `404`; a drive owned by a colleague in the same tenant
is readable and can take registrations, but only its owner can edit, change status, delete
or unlink.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Caller's own drives. `?status=DRAFT\|IN_PROGRESS\|COMPLETED\|INACTIVE` (default: all but `INACTIVE`), `?page=&limit=` (max 100), `?includeStats=true` |
| `POST` | `/` | Create (starts as `DRAFT`) |
| `GET` | `/:id` | One drive |
| `PUT` | `/:id` | Edit (owner, `DRAFT`/`IN_PROGRESS` only) |
| `PATCH` | `/:id/status` | `{ "status": "IN_PROGRESS" }` (owner) |
| `DELETE` | `/:id` | Soft delete -> `INACTIVE`; registrations keep their tag (owner) |
| `POST` | `/:id/registrations` | `{ "applicationId": "..." }` tags an application with the drive (drive must be `IN_PROGRESS`) |
| `DELETE` | `/:id/registrations/:applicationId` | Remove the tag (owner) |
| `GET` | `/:id/stats` | `{ today, total, rejoins, signUpTarget, remainingToTarget }` |

Create / edit body:

```json
{
  "name": "St James's autumn drive",
  "driveType": "WORKPLACE",
  "workLocations": ["<lookup id>", "<lookup id>"],
  "startDate": "2026-11-01",
  "endDate": "2026-11-30",
  "signUpTarget": 50,
  "notes": "Ward visits Tue/Thu"
}
```

`workLocations` takes one id or an array. `endDate` must be on or after `startDate`.

Status transitions: `DRAFT -> IN_PROGRESS | COMPLETED | INACTIVE`, `IN_PROGRESS -> COMPLETED |
INACTIVE`, `COMPLETED -> INACTIVE`. `INACTIVE` is terminal.

## Registration tagging

MembersHub creates the application as today (`POST /api/personal-details` etc.), then calls
`POST /:id/registrations` with the returned `applicationId`. The tag lives on the staging
`personalDetails.membershipDrive` (`driveId`, `linkedAt`, `linkedBy`); an application belongs
to at most one drive (`409` for a second drive, idempotent for the same one). The tag is not
copied onto `Profile` at approval - reporting joins `Profile.applicationId` ->
`personalDetails.membershipDrive.driveId`.

## Stats

- `total` - non-deleted applications tagged with the drive.
- `today` - of those, tagged since local midnight (`MEMBERSHIP_DRIVE_STATS_TIMEZONE`, default
  `Europe/Dublin`).
- `rejoins` - of those, applications whose `subscriptionDetails.membershipStatus` is `rejoin`.

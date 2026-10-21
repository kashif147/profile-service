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
| `GET` | `/:id/registrations` | Recruited applications/members, `?page=&limit=&applicationStatus=` (owner) |
| `POST` | `/:id/registrations` | `{ "applicationId": "..." }` attributes an application to the drive (see rules below) |
| `DELETE` | `/:id/registrations/:applicationId` | Remove the attribution (owner; not on `INACTIVE` drives) |
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

## Attribution rules

MembersHub creates the application as today (`POST /api/personal-details` etc.), then calls
`POST /:id/registrations` with the returned `applicationId`. The tag lives on the staging
`personalDetails.membershipDrive` (`driveId`, `linkedAt`, `linkedBy`, `late`); the Profile is
not tagged - reporting joins `Profile` -> `personalDetails.profileId` / `applicationId`.

- The application must exist in the caller's tenant (another tenant's application is a `404`).
- The application's creation date, in the organisation timezone, must fall within the drive's
  `startDate`..`endDate` (inclusive), else `409 OUTSIDE_DRIVE_WINDOW`.
- An application belongs to at most one drive: same drive is idempotent
  (`alreadyLinked: true`), another drive is `409 ALREADY_ATTRIBUTED`.

| Drive status | Attribute | Remove attribution |
|---|---|---|
| `DRAFT` | no (`409 DRIVE_NOT_ACCEPTING`) | no |
| `IN_PROGRESS` | any staff user in the tenant | owner |
| `COMPLETED` | owner only, within `MEMBERSHIP_DRIVE_LATE_LINK_GRACE_DAYS` (default 7) of completion, recorded `late: true`; afterwards `409 LATE_REGISTRATION_CLOSED` | owner, same grace period |
| `INACTIVE` | no | no (frozen for reporting) |

Error responses carry the machine-readable `reason` alongside `code`.

## Stats

All dates use the organisation timezone - user-service `Tenant.regionalSettings.timezone`,
read through the internal `GET /api/internal/tenants/:tenantId/lifecycle-config` and cached
per tenant for 10 minutes; `Europe/Dublin` when unset, invalid or unreachable. The resolved
zone is returned as `timeZone`.

- `today` - distinct applications attributed to this drive since local midnight.
- `total` - distinct non-deleted applications attributed to the drive.
- `rejoins` - of those, applications whose `subscriptionDetails.membershipStatus` is `rejoin`.

## Recruited list

`GET /:id/registrations` (drive owner only - rows carry member names) returns
`{ registrations, total, page, limit }`, newest attribution first. Each row:
`applicationId, applicationStatus, forename, surname, fullName, applicationCreatedAt,
linkedAt, linkedBy, late, isRejoin, profileId, membershipNumber` (the last two once approved).

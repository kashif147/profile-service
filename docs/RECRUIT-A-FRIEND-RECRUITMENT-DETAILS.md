# How to get recruitedBy / recruitedByMembershipNo on a recruit-a-friend batch

For a **recruit-a-friend** batch to show recruiter name and membership number (`recruitedBy`, `recruitedByMembershipNo`), the **Profile** must have those values in `recruitmentDetails`. They come from the **application’s subscription details** when the application is **approved**.

---

## 1. Create an application that will be “recruited”

- Create **Personal Details** and **Professional Details** for the new member (the “friend” being recruited).
- Create or update **Subscription Details** for that application and include the recruiter fields.

---

## 2. Set recruiter fields in Subscription Details

When creating or updating **Subscription Details** for that application, send these fields **inside** `subscriptionDetails` (exact names; there is a typo in the schema):

| Field | Type | Meaning |
|-------|------|--------|
| **recuritedBy** | string | Recruiter’s full name (e.g. "John Smith") |
| **recuritedByMembershipNo** | string | Recruiter’s membership number (e.g. "B00001") |
| **confirmedRecruiterProfileId** | string | **Required.** Profile `_id` of the recruiter (the person who referred this member). Used to include the profile in recruit-friend batches and to link recruiter. |

Example **create** body (e.g. `POST .../applications/:applicationId/subscription-details`):

```json
{
  "subscriptionDetails": {
    "recuritedBy": "John Smith",
    "recuritedByMembershipNo": "B00001",
    "confirmedRecruiterProfileId": "698b6be9cc340dc16353ebd9",
    "paymentType": "directDebit",
    "membershipCategory": "full",
    "termsAndConditions": true
  }
}
```

Example **update** body (e.g. `PUT .../applications/:applicationId/subscription-details`):

```json
{
  "subscriptionDetails": {
    "recuritedBy": "John Smith",
    "recuritedByMembershipNo": "B00001",
    "confirmedRecruiterProfileId": "698b6be9cc340dc16353ebd9"
  }
}
```

- **confirmedRecruiterProfileId** must be the **Profile** `_id` of the recruiter (existing member who referred this one). If you don’t set it, this profile will **not** be included when you create a recruit-friend batch.
- **recuritedBy** and **recuritedByMembershipNo** are what later show as “recruited by” name and number on the batch.

---

## 3. Approve the application

- Submit the application and have it **approved** (CRM approval flow).
- On approval, the profile is created/updated and `recruitmentDetails` is filled from the application’s **subscription details** (`recuritedBy`, `recuritedByMembershipNo`, `confirmedRecruiterProfileId`).

---

## 4. Create the recruit-a-friend batch

- In CRM, create a **recruit-a-friend** batch (same as you do now).
- The batch will:
  - Include only profiles that have `recruitmentDetails.confirmedRecruiterProfileId` set (that’s why step 2 is required).
  - Show `recruitedBy` and `recruitedByMembershipNo` on the batch when the profile had those set in subscription details (and the copy from Profile → Batch now reads the typo keys `recuritedBy` / `recuritedByMembershipNo`).

---

## Summary

1. **Create** an application (personal + professional + subscription details).
2. In **subscription details** set: **recuritedBy**, **recuritedByMembershipNo**, **confirmedRecruiterProfileId** (all three in `subscriptionDetails`).
3. **Approve** the application so the profile gets `recruitmentDetails` from those subscription details.
4. **Create** the recruit-a-friend batch; that application’s profile will appear in the batch with recruiter name and number.

If you create the application (and subscription details) via the **Portal** (recruit-a-friend flow), the same fields must be sent there in the subscription-details payload so they are stored and then flow into the profile on approval.

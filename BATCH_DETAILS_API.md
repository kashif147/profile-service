# Batch Details API - Quick Reference

## Create a Batch Detail

**Endpoint:** `POST /api/batch-details`  
**Auth:** Required (CRM users only)  
**Content-Type:** `multipart/form-data`

### Required Fields

| Field | Type | Example |
|-------|------|---------|
| type | string | `deduction`, `cheque`, or `other` |
| batchDate (or date) | string (date) | `2025-02-07` |
| referenceNumber | string | `BATCH-001` |
| description | string | `Batch payment file for February` |
| paymentDate | string (date) | `2025-02-07` |
| workLocation | string | Required when type is `deduction` |
| bank | string | Required when type is `cheque` |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| comments | string | Additional notes |
| file | file | Excel file (.xlsx) with membership numbers |

### Value and Exceptions

- **Value per period (Euro → Cents)**: Values from the file are in Euro. They are multiplied by 100 and stored as cents.
- **Exceptions**: When a profile is matched but value per period is null, 0, or not present, the row goes to `batchExceptions` (not `batchPayments`).

### Response (201 Created)

```json
{
  "message": "Batch detail created successfully",
  "data": {
    "_id": "67...",
    "tenantId": "68cbf...",
    "type": "deduction",
    "batchDate": "2025-02-07T00:00:00.000Z",
    "paymentDate": null,
    "workLocation": "Dublin",
    "bank": null,
    "batchStatus": "pending",
    "referenceNumber": "BATCH-001",
    "description": "Batch payment file for February",
    "comments": "Optional comments",
    "fileName": "Batch_Payment_Template.xlsx",
    "fileUrl": "https://...",
    "batchPayments": [...],
    "batchExceptions": [...],
    "createdBy": "692b...",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

## Postman Setup

1. **Method:** POST
2. **URL:** `http://projectshell-vm.northeurope.cloudapp.azure.com/profile-service/api/batch-details`
3. **Headers:**
   - `Authorization: Bearer YOUR_TOKEN`
   - (Do NOT set Content-Type - Postman sets it automatically for form-data)
4. **Body:**
   - Select **form-data** (not raw, not JSON)
   - Add fields:
     - `type` = `deduction`
     - `batchDate` or `date` = `2025-02-07`
     - `referenceNumber` = `BATCH-001`
     - `description` = `Test batch`
     - `workLocation` = `Dublin` (required when type is deduction)
     - `bank` = `Bank Name` (required when type is cheque)
     - `comments` = `Optional`
     - `file` = (select your .xlsx file)
5. **Settings:**
   - Turn OFF "Automatically follow redirects" (Settings → General)

## Troubleshooting

### Problem: Getting `{ "data": [], "pagination": {...} }` response

**Cause:** You're hitting the **list** endpoint (GET) instead of **create** (POST).

**Fix:**
1. Check Postman method dropdown - must be **POST**, not GET
2. Turn OFF "Follow redirects" in Postman settings
3. Send the request
4. If you get **301/302** response: your POST is being redirected to GET
   - Fix the gateway/proxy to not redirect POST requests

### Problem: Getting 400 "METHOD_MISMATCH" error

**Cause:** POST was converted to GET by redirect/proxy

**Fix:** 
- Turn OFF "Follow redirects" in Postman
- Check gateway/proxy configuration
- Or call profile-service directly (bypass gateway)

## curl Example

```bash
curl -X POST "http://projectshell-vm.northeurope.cloudapp.azure.com/profile-service/api/batch-details" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "type=deduction" \
  -F "batchDate=2025-02-07" \
  -F "referenceNumber=BATCH-001" \
  -F "description=Batch payment file" \
  -F "workLocation=Dublin" \
  -F "file=@/path/to/file.xlsx"
```

## Expected Server Logs (Success)

When create works, you'll see:

```
=== [BatchDetail] RAW REQUEST ===
Method: POST
Path: /
URL: /
Content-Type: multipart/form-data; boundary=...
================================
[BatchDetail] ✅ POST handler is running! (This is the CREATE endpoint)
[BatchDetail] createBatchDetail: request received
[BatchDetail] createBatchDetail: document saved
[BatchDetail] processBatchDetailWithBuffer: parsed file
[BatchDetail] processBatchDetailWithBuffer: profile lookup
[BatchDetail] processBatchDetailWithBuffer: done
[BatchDetail] createBatchDetail: file processed
[BatchDetail] createBatchDetail: responding 201
```

## List All Batches

**Endpoint:** `GET /api/batch-details`  
**Auth:** Required  
**Query Params:** `?page=1&limit=20&type=deduction`

Response: `{ "data": [...], "pagination": {...} }`

---

## Resolve Batch Exception (attach profile and move to batch payment)

When a row in the file has a wrong or typo membership number (e.g. file has `M3245`, actual is `M12345`), it lands in **batch exceptions**. The admin calls this POST API with the **Batch ID** and the **two membership numbers**: the correct one (to find the user) and the exception reference (to identify the row). That user is **removed from batch exceptions** and **added to batch payment**; all display data comes from the profile.

**Endpoint:** `POST /api/batch-details/:batchDetailId/resolve-exception`  
**Auth:** Required (CRM users only)  
**Content-Type:** `application/json`

### Required in the API

1. **Batch ID** – in the URL (`:batchDetailId`).
2. **membershipNumber** – correct profile membership number (the user to attach; they will be removed from exceptions and added to batch payment).
3. **exceptionMembershipNumber** – reference number from the batch exception row (the value from the file; identifies which exception row to resolve).

### Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| membershipNumber | string | Yes | Correct profile membership number (e.g. `M12345`). Used to find the user and add them to batch payment. |
| exceptionMembershipNumber | string | Yes | Reference number from the exception row (e.g. `M3245`). Identifies which row to remove from exceptions. |

### Example

```json
POST /api/batch-details/67.../resolve-exception
{
  "membershipNumber": "M12345",
  "exceptionMembershipNumber": "M3245"
}
```

### Response (200 OK)

```json
{
  "message": "Batch exception resolved; row moved to batch payment",
  "data": { ... full batch detail with updated batchPayments and batchExceptions ... }
}
```

### Validation errors (4xx)

| Situation | HTTP | Message |
|-----------|------|--------|
| Batch ID invalid or batch not present | 404 | `Batch not found. Please check the batch ID.` |
| Exception membership number not in this batch | 404 | `There is no member with this membership number in batch exceptions. No exception found for "<value>".` |
| Correct membership number not in profiles | 404 | `Please provide the correct membership number. No profile found with this membership number.` |
| Missing body fields | 400 | `membershipNumber is required...` / `exceptionMembershipNumber is required...` |

### curl example (resolve exception)

Replace `YOUR_TOKEN`, `BATCH_DETAIL_ID`, and the membership numbers as needed.

```bash
curl -X POST "http://projectshell-vm.northeurope.cloudapp.azure.com/profile-service/api/batch-details/BATCH_DETAIL_ID/resolve-exception" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "membershipNumber": "M12345",
    "exceptionMembershipNumber": "M3245"
  }'
```

**Example with real values:**

```bash
curl -X POST "http://projectshell-vm.northeurope.cloudapp.azure.com/profile-service/api/batch-details/67f1a2b3c4d5e6f7a8b9c0d1/resolve-exception" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{"membershipNumber":"M12345","exceptionMembershipNumber":"M3245"}'
```

**Success (200):** response body includes `message` and full batch `data` with updated `batchPayments` and `batchExceptions`.

**Validation errors (404):** response body is JSON, e.g. `{"success":false,"message":"Please provide the correct membership number. No profile found with this membership number."}`.

### Frontend flow

1. Batch exceptions list shows each row with **reference number** = membership number from file (e.g. `M3245`).
2. Admin enters the **correct** membership number (e.g. `M12345`) for that user.
3. Frontend calls **resolve-exception**: `POST /api/batch-details/:batchDetailId/resolve-exception` with body `{ "membershipNumber": "M12345", "exceptionMembershipNumber": "M3245" }`.
4. That row is removed from exceptions and added to batch payment with profile data.

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

When a row in the file has a wrong or typo membership number (e.g. file has `M3245`, actual is `M12345`), it lands in **batch exceptions**. The admin can search for the user by the correct membership number (using the existing profile search API), then call this API to attach that profile to the exception row. The row is **removed from batch exceptions** and **added to batch payment**; all display data (name, email, etc.) comes from the profile, and the file row is kept as `fileRow` for reference.

**Endpoint:** `POST /api/batch-details/:batchDetailId/resolve-exception`  
**Auth:** Required (CRM users only)  
**Content-Type:** `application/json`

### Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| rowIndex | number | Yes | The 1-based row index of the exception row (from the file). Identifies which exception to resolve. |
| profileId | string | No* | Profile ID (e.g. from profile search result). |
| membershipNumber | string | No* | Correct membership number (e.g. `M12345`). Used to look up the profile. |

\* One of `profileId` or `membershipNumber` is required.

### Example

```json
POST /api/batch-details/67.../resolve-exception
{
  "rowIndex": 5,
  "membershipNumber": "M12345"
}
```

Or with profileId (e.g. after profile search):

```json
{
  "rowIndex": 5,
  "profileId": "692b..."
}
```

### Response (200 OK)

```json
{
  "message": "Batch exception resolved; row moved to batch payment",
  "data": { ... full batch detail with updated batchPayments and batchExceptions ... }
}
```

### Frontend flow

1. Batch exceptions list shows each row with **reference number** = membership number from file (e.g. `M3245`).
2. Admin types the **correct** membership number (e.g. `M12345`) in a search field.
3. Frontend calls **profile search** (e.g. `GET /api/profile/search?q=M12345`) and shows results.
4. Admin selects the matching profile.
5. Frontend calls **resolve-exception** with `batchDetailId`, `rowIndex` of that exception row, and `profileId` (or `membershipNumber`).
6. That row disappears from exceptions and appears in batch payment with profile data and file row reference.

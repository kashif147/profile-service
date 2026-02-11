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

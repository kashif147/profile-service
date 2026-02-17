# Batch process & batch details – flow and implementation

This doc describes how batch details work when there are **hundreds of users** in the file: what runs when, where it runs, and what is already in place.

---

## 1. High-level flow

```
User uploads Excel → Create batch detail → Parse file & match profiles → batchPayments / batchExceptions
                                                                              ↓
User clicks "Process batch" → 202 Accepted → RabbitMQ → Worker processes in CHUNKS → account-service
                                                                              ↓
                                    batchStatus → "processed" or "failed"
```

---

## 2. Step-by-step process

### Step 1: Create batch detail (upload file)

- **API:** `POST /api/create-batch` or `POST /api/batch-details` (multipart with file).
- **What happens:**
  1. File is uploaded (e.g. to Azure Blob); a `BatchDetail` document is created with `batchStatus: "pending"`.
  2. **Immediately after save**, the same request runs **file processing** in-process:
     - Excel is parsed in memory (`parseRows(buffer)`).
     - **All rows** are read (no limit); columns are detected from header (Membership No, Last name, First name, Full name, Value for period).
     - Unique membership numbers are collected; **one bulk query** loads all matching profiles:  
       `Profile.find({ membershipNumber: { $in: membershipNumbers } })`.
     - Each row is matched:
       - **Matched + valid value** → added to `batchPayments`.
       - **Matched + no/zero value** or **not matched** → added to `batchExceptions`.
  3. `batchPayments` and `batchExceptions` are saved on the same `BatchDetail` document.

So for **hundreds of users in the file**:

- Parsing is one pass over the Excel (all rows).
- Profile lookup is **one** `$in` query (all unique membership numbers).
- No chunking in this step; it runs in the HTTP request. For very large files (e.g. 10k+ rows), you could later move this to a background job; currently it’s synchronous after create.

---

### Step 2: Process batch (send to account-service)

- **API:** `POST /api/batch-details/process/:batchDetailId`
- **Response:** **202 Accepted** + `{ success: true, message: "Batch processing started", batchId }`

**What happens:**

1. **In the API (controller):**
   - Validates batch exists, not already processed, and has `batchPayments.length > 0`.
   - Sets `batchStatus: "processing"`.
   - Publishes a **single message** to RabbitMQ: `batch.process.requested` with `{ batchDetailId, tenantId, userId, authorization }`.
   - Returns 202 immediately (no waiting for the actual processing).

2. **In the background (RabbitMQ consumer):**
   - A worker consumes `batch.process.requested`.
   - It calls **`runBatchProcessing(batchDetailId, tenantId, options)`** in `services/batch.process.job.service.js`.

3. **Inside `runBatchProcessing` (handling hundreds of users):**
   - Loads the batch detail once; reads `batchPayments` (all of them).
   - **Chunks** the array: `PROCESS_BATCH_CHUNK_SIZE` (env, default **250**).
   - For **each chunk**:
     - POSTs that chunk to **account-service**: `POST {account-service}/api/journal/process-batch` with `{ paymentDate, batchPayments: chunk }`.
     - Accumulates `processed` / `failed` and any errors.
   - After **all chunks** succeed:
     - Updates batch: `batchStatus: "processed"`.
   - On any chunk error or exception:
     - Sets `batchStatus: "failed"` and returns.

So for **hundreds of users** (e.g. 800):

- 800 payments → e.g. 4 chunks of 250.
- Multiple HTTP calls to account-service; no single huge payload.
- Chunk size is configurable via **`PROCESS_BATCH_CHUNK_SIZE`** (default 250).

---

## 3. Current implementation summary

| Part | Where | Handles large file? | Notes |
|------|--------|----------------------|--------|
| File upload & parse | `batch.detail.controller` + `batch.payment.process.service` | All rows in one go | One bulk profile lookup; in-process. |
| Match rows → batchPayments / batchExceptions | `processBatchDetailWithBuffer` | Yes (bulk query) | No chunking; single DB write for batch detail. |
| Trigger process | `POST .../process/:batchDetailId` | N/A | Returns 202; job is async. |
| Actual processing | `batch.process.job.service` + RabbitMQ consumer | **Yes (chunked)** | Chunks of 250 (configurable); multiple POSTs to account-service. |
| Status for UI | `GET /api/batch-details/:batchDetailId` | N/A | Frontend polls until `batchStatus` is `processed` or `failed`. |

---

## 4. What you have already (no change required for “hundreds of users”)

- **Batch details** created with file; file parsed and matched in one request.
- **Chunked processing** when sending to account-service (hundreds of users = multiple chunks of 250).
- **Async processing**: 202 + RabbitMQ + worker so the API doesn’t time out.
- **Status**: `pending` → `processing` → `processed` or `failed`.
- **Frontend**: Polling (see `BATCH_PROCESS_ASYNC_FRONTEND.md`) or future WebSocket on `batch.process.completed`.

---

## 5. Optional improvements you can add

If you want to extend or harden the implementation:

1. **Very large uploads (e.g. 10k+ rows)**  
   - Move “parse file + match profiles” to a **background job** (e.g. after upload, publish `batch.file.uploaded` → worker runs `processBatchDetailWithBuffer` or `processBatchDetail` and then sets status to `pending` with `batchPayments`/`batchExceptions` populated).  
   - Keeps create response fast and avoids long HTTP timeouts.

2. **Chunk size**  
   - Already configurable: `PROCESS_BATCH_CHUNK_SIZE` (default 250). Increase if account-service accepts larger payloads; decrease if you hit timeouts or memory limits.

3. **Progress for UI**  
   - Optionally store `processedCount` / `totalCount` (or chunk index) on `BatchDetail` and update per chunk so the frontend can show “Processing 500/2000” via `GET /api/batch-details/:id`.

4. **Retries**  
   - RabbitMQ message TTL and dead-letter/retry for failed chunk so a transient account-service error doesn’t leave the batch stuck in `processing`.

5. **Idempotency**  
   - Already guarded: if `batchStatus === "processed"`, the worker does nothing and the API returns 400 for “Process batch” so you don’t double-process.

---

## 6. Env / config

- **`PROCESS_BATCH_CHUNK_SIZE`** – Chunk size for sending `batchPayments` to account-service (default 250).
- **`ACCOUNT_SERVICE_URL`** – Base URL for account-service (e.g. `.../api/journal/process-batch`).
- **RabbitMQ** – For `batch.process.requested` / `batch.process.completed` and the batch process queue.

---

## 7. Quick reference

| Action | API | Result |
|--------|-----|--------|
| Create batch (with file) | `POST /api/batch-details` (multipart) | 201; file parsed; `batchPayments` + `batchExceptions` filled. |
| Process batch | `POST /api/batch-details/process/:batchDetailId` | 202; job queued; worker processes in chunks. |
| Check status | `GET /api/batch-details/:batchDetailId` | `data.batchStatus`: `pending` \| `processing` \| `processed` \| `failed`. |

So: **hundreds of users in the file** are already supported by **chunked processing** when sending to account-service; the only part that runs in one go is the initial file parse and profile match at create time, which is fine for hundreds of rows. If you later have files with many thousands of rows, add the optional “background file processing” step above.

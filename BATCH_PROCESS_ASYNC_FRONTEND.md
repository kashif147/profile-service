# Batch process async – frontend integration (React + toaster)

The **Process batch** API returns **202 Accepted** and runs the job in the background. Use **polling** (or later WebSockets) to show a toaster when the batch is done.

## API contract

- **Start processing:** `POST /api/batch-details/process/:batchDetailId`  
  - **202** → `{ success: true, message: "Batch processing started", batchId }`
- **Check status:** `GET /api/batch-details/:batchDetailId`  
  - Response includes `data.batchStatus`: `"pending"` | `"processing"` | `"processed"` | `"failed"`

## React example: polling + toaster

Assume you have an API client and a toast library (e.g. `react-toastify`).

```jsx
import { useState, useCallback } from "react";
import { toast } from "react-toastify"; // or your toast library

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 120; // 10 minutes at 5s

export function useProcessBatch(api) {
  const [isStarting, setIsStarting] = useState(false);
  const [pollingBatchId, setPollingBatchId] = useState(null);

  const startProcess = useCallback(
    async (batchDetailId) => {
      if (isStarting || pollingBatchId) return;
      setIsStarting(true);
      try {
        const res = await api.post(`/api/batch-details/process/${batchDetailId}`);
        if (res.status === 202 && res.data?.batchId) {
          toast.info("Batch processing started.");
          setPollingBatchId(res.data.batchId);
        } else {
          toast.error(res.data?.message || "Failed to start batch");
        }
      } catch (e) {
        toast.error(e.response?.data?.message || "Failed to start batch");
      } finally {
        setIsStarting(false);
      }
    },
    [api, isStarting, pollingBatchId]
  );

  const pollBatchStatus = useCallback(
    async (batchDetailId) => {
      const res = await api.get(`/api/batch-details/${batchDetailId}`);
      return res.data?.data?.batchStatus;
    },
    [api]
  );

  // Run this in a useEffect when pollingBatchId is set
  const startPolling = useCallback(
    (batchDetailId) => {
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        if (attempts > MAX_POLL_ATTEMPTS) {
          clearInterval(interval);
          setPollingBatchId(null);
          toast.warning("Batch status check timed out.");
          return;
        }
        const status = await pollBatchStatus(batchDetailId);
        if (status === "processed") {
          clearInterval(interval);
          setPollingBatchId(null);
          toast.success("Batch completed successfully.");
        } else if (status === "failed") {
          clearInterval(interval);
          setPollingBatchId(null);
          toast.error("Batch processing failed.");
        }
      }, POLL_INTERVAL_MS);
      return () => clearInterval(interval);
    },
    [pollBatchStatus]
  );

  return { startProcess, pollingBatchId, startPolling };
}
```

Usage in a component:

```jsx
function BatchDetailActions({ batchId, batchStatus }) {
  const api = useApi(); // your axios/fetch wrapper with auth
  const { startProcess, pollingBatchId, startPolling } = useProcessBatch(api);

  useEffect(() => {
    if (!pollingBatchId) return;
    return startPolling(pollingBatchId);
  }, [pollingBatchId, startPolling]);

  const handleProcess = () => {
    startProcess(batchId);
  };

  const isProcessing = batchStatus === "processing" || pollingBatchId === batchId;

  return (
    <button
      onClick={handleProcess}
      disabled={batchStatus === "processed" || batchStatus === "processing" || isProcessing}
    >
      {isProcessing ? "Processing…" : "Process batch"}
    </button>
  );
}
```

## Optional: WebSockets later

When you add a notification service that subscribes to `batch.process.completed` (from RabbitMQ) and pushes to the client via WebSocket, you can:

1. Listen for an event like `batchCompleted({ batchId, success })`.
2. On that event, show the toaster and stop polling for that `batchId`.

Until then, polling **GET /api/batch-details/:batchDetailId** is the recommended way to know when the batch is done.

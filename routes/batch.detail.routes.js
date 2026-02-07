const express = require("express");
const router = express.Router();
const batchDetailController = require("../controllers/batch.detail.controller");
const { authenticate } = require("../middlewares/auth");
const { uploadSingleOptional } = require("../middlewares/upload.mw");

// Log IMMEDIATELY when request hits this router (before auth, before anything)
router.use((req, res, next) => {
  console.log("=== [BatchDetail] RAW REQUEST ===");
  console.log("Method:", req.method);
  console.log("Path:", req.path);
  console.log("URL:", req.url);
  console.log("Content-Type:", req.get("content-type"));
  console.log("Origin:", req.get("origin") || "none");
  console.log("================================");
  next();
});

// All routes require authentication
router.use(authenticate);

// Safeguard: if GET is called with multipart content-type (POST was converted to GET)
router.use((req, res, next) => {
  const contentType = req.get("content-type") || "";
  
  if (req.method === "GET" && req.path === "/" && contentType.includes("multipart/form-data")) {
    console.error("[BatchDetail] ❌ ERROR: GET request with multipart/form-data detected!");
    console.error("[BatchDetail] This means your POST was converted to GET by redirect or proxy.");
    return res.status(400).json({
      error: "METHOD_MISMATCH",
      message: "ERROR: Server received GET but with multipart/form-data. Your POST request was converted to GET (usually by a 301/302 redirect).",
      solution: "In Postman: Settings → turn OFF 'Follow redirects'. Then send POST again and check if you get 301/302 response.",
      expectedMethod: "POST",
      receivedMethod: "GET",
      contentType: contentType,
    });
  }
  
  next();
});

// Create batch detail (CRM only). Required: type, date, referenceNumber, description. Optional: comments, file.
// File must be sent as type=file (from computer). If file is uploaded, fileUrl is saved on the batch (no expiry).
// Content-Type: multipart/form-data
router.post(
  "/",
  (req, res, next) => {
    console.log("[BatchDetail] ✅ POST handler is running! (This is the CREATE endpoint)");
    console.log("[BatchDetail] Content-Type:", req.get("content-type"));
    next();
  },
  batchDetailController.requireCrm,
  uploadSingleOptional,
  batchDetailController.createBatchDetail
);

// Get all batch details (pagination, optional ?type=deduction|cheque, ?page=1, ?limit=20)
router.get("/", batchDetailController.getAllBatchDetails);

// Get one batch detail by ID. Returns full batch with batchPayments (matched members) and batchExceptions (unmatched) populated; fileUrl on batch has no expiry.
router.get("/:batchDetailId", batchDetailController.getBatchDetailById);

// Update batch detail (CRM only). Optional file replacement via multipart/form-data
router.put(
  "/:batchDetailId",
  batchDetailController.requireCrm,
  uploadSingleOptional,
  batchDetailController.updateBatchDetail
);

// Soft delete batch detail (CRM only)
router.delete(
  "/:batchDetailId",
  batchDetailController.requireCrm,
  batchDetailController.deleteBatchDetail
);

module.exports = router;

const express = require("express");
const router = express.Router();
const batchDetailController = require("../controllers/batch.detail.controller");
const { authenticate } = require("../middlewares/auth");
const { uploadSingleOptional } = require("../middlewares/upload.mw");

// All routes require authentication
router.use(authenticate);

// Create batch detail (CRM only). Required: type, date, referenceNumber, description. Optional: comments, file.
// File must be sent as type=file (from computer). If file is uploaded, fileUrl is saved on the batch (no expiry).
// Content-Type: multipart/form-data
router.post(
  "/",
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

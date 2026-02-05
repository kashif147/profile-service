const express = require("express");
const router = express.Router();
const batchDetailController = require("../controllers/batch.detail.controller");
const { authenticate } = require("../middlewares/auth");
const { uploadSingleOptional } = require("../middlewares/upload.mw");

// All routes require authentication
router.use(authenticate);

// Create batch detail (CRM only): type, date, referenceNumber, description, comments, optional file
// Content-Type: multipart/form-data
router.post(
  "/",
  batchDetailController.requireCrm,
  uploadSingleOptional,
  batchDetailController.createBatchDetail
);

// Get all batch details (pagination, optional ?type=deduction|cheque, ?page=1, ?limit=20)
router.get("/", batchDetailController.getAllBatchDetails);

// Process batch: process comes before ID — POST /batch-details/process/:batchDetailId
router.post(
  "/process/:batchDetailId",
  batchDetailController.requireCrm,
  batchDetailController.processBatchDetail
);

// Get time-limited download URL for the attached file (?expiryMinutes=60)
router.get(
  "/:batchDetailId/download-url",
  batchDetailController.getBatchDetailFileDownloadUrl
);

// List batch payments (members found in system) for this batch detail
router.get(
  "/:batchDetailId/payments",
  batchDetailController.getBatchPayments
);

// List batch payment exceptions (members not found) for this batch detail
router.get(
  "/:batchDetailId/exceptions",
  batchDetailController.getBatchPaymentExceptions
);

// Get one batch detail by ID
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

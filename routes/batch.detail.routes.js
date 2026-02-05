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

// Get all batch details (pagination, optional ?type=check|deduction, ?page=1, ?limit=20)
router.get("/", batchDetailController.getAllBatchDetails);

// Get time-limited download URL for the attached file (?expiryMinutes=60) — must be before /:id
router.get(
  "/:batchDetailId/download-url",
  batchDetailController.getBatchDetailFileDownloadUrl
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

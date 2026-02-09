const express = require("express");
const router = express.Router();
const batchDetailController = require("../controllers/batch.detail.controller");
const { authenticate } = require("../middlewares/auth");
const { uploadSingleOptional } = require("../middlewares/upload.mw");

// All routes require authentication
router.use(authenticate);

// ----- POST: Create batch (form-data: type, date, referenceNumber, description; optional: comments, file) -----
router.post("/", batchDetailController.requireCrm, uploadSingleOptional, batchDetailController.createBatchDetail);
router.post("/create", batchDetailController.requireCrm, uploadSingleOptional, batchDetailController.createBatchDetail);

// ----- GET list: commented out so redirected POST doesn't show "No batch details found" -----
// router.get("/", batchDetailController.getAllBatchDetails);

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

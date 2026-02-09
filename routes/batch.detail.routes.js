const express = require("express");
const router = express.Router();
const batchDetailController = require("../controllers/batch.detail.controller");
const { authenticate } = require("../middlewares/auth");
const { uploadSingleOptional } = require("../middlewares/upload.mw");

// All routes require authentication
router.use(authenticate);

// Create batch detail — accepts ANY method (POST or GET) because the gateway
// converts POST to GET via redirect. This ensures create always works.
router.all("/", batchDetailController.requireCrm, uploadSingleOptional, batchDetailController.createBatchDetail);
router.all("/create", batchDetailController.requireCrm, uploadSingleOptional, batchDetailController.createBatchDetail);

// Get one batch detail by ID
router.get("/:batchDetailId", batchDetailController.getBatchDetailById);

module.exports = router;

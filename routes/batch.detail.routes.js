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

// Create batch detail (CRM only). Required: type, date, referenceNumber, description. Optional: comments, file.
// Content-Type: multipart/form-data
// Two paths so gateway redirect on "/" doesn't block create: POST / and POST /create
const createMiddleware = [
  (req, res, next) => {
    console.log("[BatchDetail] ✅ CREATE handler running", { path: req.path, method: req.method });
    next();
  },
  batchDetailController.requireCrm,
  uploadSingleOptional,
  batchDetailController.createBatchDetail,
];

router.post("/", ...createMiddleware);
router.post("/create", ...createMiddleware);

// Get all batch details (list only). POST must use / or /create above.
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

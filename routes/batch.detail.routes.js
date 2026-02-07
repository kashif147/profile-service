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
// Workaround: if GET has multipart/form-data (proxy/gateway converted POST→GET), parse body and run create
router.get("/", (req, res, next) => {
  const contentType = req.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return batchDetailController.getAllBatchDetails(req, res, next);
  }
  console.log("[BatchDetail] Workaround: GET with multipart/form-data - treating as CREATE (redirect/proxy converted POST to GET)");
  uploadSingleOptional(req, res, (err) => {
    if (err) return next(err);
    if (!req.body.type || !req.body.referenceNumber || !req.body.date || !req.body.description) {
      return res.status(400).json({
        error: "BODY_STRIPPED",
        message: "Request has multipart content-type but required fields (type, date, referenceNumber, description) are missing. The redirect may have stripped the body. Fix: turn OFF 'Follow redirects' in Postman and send POST.",
      });
    }
    batchDetailController.requireCrm(req, res, (err) => {
      if (err) return next(err);
      batchDetailController.createBatchDetail(req, res, next);
    });
  });
});

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

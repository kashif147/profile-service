const express = require("express");
const router = express.Router();
const { authenticate } = require("../middlewares/auth");
const { uploadSingleOptional } = require("../middlewares/upload.mw");
const { createBatchDetail, getBatchDetailById, getAllBatchDetails, resolveBatchException, addPaymentToBatch } = require("../controllers/batch.detail.controller");

router.use(authenticate);

// ONE create API — POST only (form-data with file)
router.post("/",
  (req, res, next) => {
    if (req.user?.userType !== "CRM") {
      return res.status(403).json({ success: false, message: "Only CRM users can create batch details" });
    }
    next();
  },
  uploadSingleOptional,
  createBatchDetail
);

// Get all batch details (list with pagination)
router.get("/", getAllBatchDetails);

// Add a profile/payment to a batch manually — ID at end: /batch-details/add-profile/:batchDetailId
router.post(
  "/add-profile/:batchDetailId",
  (req, res, next) => {
    if (req.user?.userType !== "CRM") {
      return res.status(403).json({ success: false, message: "Only CRM users can add payments to batch details" });
    }
    next();
  },
  addPaymentToBatch
);

// Resolve a batch exception — ID at end: /batch-details/resolve-exception/:batchDetailId
router.post(
  "/resolve-exception/:batchDetailId",
  (req, res, next) => {
    if (req.user?.userType !== "CRM") {
      return res.status(403).json({ success: false, message: "Only CRM users can resolve batch exceptions" });
    }
    next();
  },
  resolveBatchException
);

// Get single batch detail by ID (must be last to avoid capturing add-payment, resolve-exception as IDs)
router.get("/:batchDetailId", getBatchDetailById);

module.exports = router;

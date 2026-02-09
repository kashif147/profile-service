const express = require("express");
const router = express.Router();
const { authenticate } = require("../middlewares/auth");
const { uploadSingleOptional } = require("../middlewares/upload.mw");
const { createBatchDetail, getBatchDetailById } = require("../controllers/batch.detail.controller");

router.use(authenticate);

// ONE create API — accepts any method so gateway redirect (POST→GET) still works
router.all("/", (req, res, next) => {
  // CRM check
  if (req.user?.userType !== "CRM") {
    return res.status(403).json({ success: false, message: "Only CRM users can create batch details" });
  }
  // Parse file if present
  uploadSingleOptional(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    createBatchDetail(req, res, next);
  });
});

// Get one by ID
router.get("/:batchDetailId", getBatchDetailById);

module.exports = router;

const express = require("express");
const router = express.Router();
const { authenticate } = require("../middlewares/auth");
const { uploadSingleOptional } = require("../middlewares/upload.mw");
const { createBatchDetail, getBatchDetailById } = require("../controllers/batch.detail.controller");

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

// Get one by ID
// router.get("/:batchDetailId", getBatchDetailById);

module.exports = router;

const express = require("express");
const router = express.Router();
const transferRequestController = require("../controllers/transfer.request.controller");
const { authenticate } = require("../middlewares/auth");

router.post("/", authenticate, transferRequestController.submitTransferRequest);

// Get transfer requests (supports filters: status, userId, myRequests=true)
// Filter like: status: pending, approved, rejected
router.get("/", authenticate, transferRequestController.getTransferRequests);

// Approve or reject transfer request
router.put("/:requestId", authenticate, transferRequestController.reviewTransferRequest);

module.exports = router;

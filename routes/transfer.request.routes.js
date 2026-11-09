const express = require("express");
const router = express.Router();
const transferRequestController = require("../controllers/transfer.request.controller");
const { authenticate } = require("../middlewares/auth");
const { requireCrm } = require("../middlewares/memberAccess");
const { requireTransferReviewer } = require("../middlewares/p5ActionGuards");

router.post("/", authenticate, transferRequestController.submitTransferRequest);

// Backward-compatible route - automatically routes based on userType
// Get transfer requests (supports filters: status, userId, myRequests=true)
router.get("/", authenticate, transferRequestController.getTransferRequests);

// Get transfer requests for CRM users (supports filters: status, userId)
// Filter like: status: pending, approved, rejected
router.get("/crm", authenticate, transferRequestController.getTransferRequestsForCRM);

// Get transfer requests for Portal users (supports filters: status)
// Portal users can only see their own requests
router.get("/portal", authenticate, transferRequestController.getTransferRequestsForPortal);

// Approve or reject transfer request (CRM). P6: PDP transferRequests:write, then ASU or MO + the claim (REO stays
// read-only). Portal submit and own-list above are unchanged.
router.put(
  "/:requestId",
  authenticate,
  requireCrm("transferRequests", "write"),
  requireTransferReviewer,
  transferRequestController.reviewTransferRequest
);

module.exports = router;

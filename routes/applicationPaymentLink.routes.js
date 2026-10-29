const express = require("express");
const router = express.Router();
const controller = require("../controllers/applicationPaymentLink.controller.js");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");

// Deferred payment links (account-service docs/design/IMPLEMENTATION_PLAN.md s.2.1).
// Gated on their own resource; nothing here is reachable through portal:* or base grants.
router.post(
  "/:applicationId/payment-link",
  defaultPolicyMiddleware.requirePermission("application-payment-links", "write"),
  controller.requestPaymentLink
);
router.get(
  "/:applicationId/payment",
  defaultPolicyMiddleware.requirePermission("application-payment-links", "read"),
  controller.getApplicationPayment
);

module.exports = router;

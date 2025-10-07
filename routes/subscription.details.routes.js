const express = require("express");
const router = express.Router();
const subscriptionDetailsController = require("../controllers/subscription.details.controller");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");

router.post(
  "/:applicationId",
  defaultPolicyMiddleware.requirePermission("portal", "create"),
  subscriptionDetailsController.createSubscriptionDetails
);
router.get(
  "/:applicationId",
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  subscriptionDetailsController.getSubscriptionDetails
);
router.put(
  "/:applicationId",
  defaultPolicyMiddleware.requirePermission("portal", "write"),
  subscriptionDetailsController.updateSubscriptionDetails
);
router.delete(
  "/:applicationId",
  defaultPolicyMiddleware.requirePermission("portal", "delete"),
  subscriptionDetailsController.deleteSubscriptionDetails
);

module.exports = router;

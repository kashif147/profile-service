const express = require("express");
const router = express.Router();
const subscriptionDetailsController = require("../controllers/subscription.details.controller");
const { crmOrPortal, crmOrOwnApplication } = require("../middlewares/memberAccess");

// P5 portal object authorization: a portal caller reaches only steps of its own application
// (middlewares/memberAccess.js crmOrOwnApplication); CRM keeps the existing PDP permission.

router.post(
  "/:applicationId",
  crmOrOwnApplication("portal", "create"),
  subscriptionDetailsController.createSubscriptionDetails
);
router.get(
  "/",
  crmOrPortal("portal", "read"),
  subscriptionDetailsController.getMySubscriptionDetails
);
router.get(
  "/:applicationId",
  crmOrOwnApplication("portal", "read"),
  subscriptionDetailsController.getSubscriptionDetails
);
router.put(
  "/:applicationId",
  crmOrOwnApplication("portal", "write"),
  subscriptionDetailsController.updateSubscriptionDetails
);
router.delete(
  "/:applicationId",
  crmOrOwnApplication("portal", "delete"),
  subscriptionDetailsController.deleteSubscriptionDetails
);

module.exports = router;

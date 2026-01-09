const express = require("express");
const router = express.Router();
const personalDetailsController = require("../controllers/personal.details.controller");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");

router.post(
  "/",
  defaultPolicyMiddleware.requirePermission("portal", "create"),
  personalDetailsController.createPersonalDetails
);
router.post(
  "/check-email",
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  personalDetailsController.checkEmailExists
);
router.get(
  "/",
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  personalDetailsController.getMyPersonalDetails
);
router.get(
  "/:applicationId",
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  personalDetailsController.getPersonalDetails
);
router.get(
  "/:applicationId/status",
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  personalDetailsController.getApplicationStatus
);
router.put(
  "/:applicationId",
  defaultPolicyMiddleware.requirePermission("portal", "write"),
  personalDetailsController.updatePersonalDetails
);
router.delete(
  "/:applicationId",
  defaultPolicyMiddleware.requirePermission("portal", "delete"),
  personalDetailsController.deletePersonalDetails
);

module.exports = router;

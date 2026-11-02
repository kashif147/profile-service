const express = require("express");
const router = express.Router();
const personalDetailsController = require("../controllers/personal.details.controller");
const {
  requireCrm,
  crmOrPortal,
  crmOrOwnApplication,
} = require("../middlewares/memberAccess");

// P5 portal object authorization: a portal caller reaches only its own application
// (middlewares/memberAccess.js crmOrOwnApplication); CRM keeps the existing PDP permission.
router.post(
  "/",
  crmOrPortal("portal", "create"),
  personalDetailsController.createPersonalDetails
);
// Returns another person's profile / application details by email: CRM duplicate check only.
router.post(
  "/check-email",
  requireCrm("portal", "read"),
  personalDetailsController.checkEmailExists
);
router.get(
  "/",
  crmOrPortal("portal", "read"),
  personalDetailsController.getMyPersonalDetails
);
router.get(
  "/:applicationId",
  crmOrOwnApplication("portal", "read"),
  personalDetailsController.getPersonalDetails
);
router.get(
  "/:applicationId/status",
  crmOrOwnApplication("portal", "read"),
  personalDetailsController.getApplicationStatus
);
router.put(
  "/:applicationId",
  crmOrOwnApplication("portal", "write"),
  personalDetailsController.updatePersonalDetails
);
router.delete(
  "/:applicationId",
  crmOrOwnApplication("portal", "delete"),
  personalDetailsController.deletePersonalDetails
);

module.exports = router;

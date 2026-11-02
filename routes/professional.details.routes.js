const express = require("express");
const router = express.Router();
const professionalDetailsController = require("../controllers/professional.details.controller");
const { requireCrm, crmOrPortal, crmOrOwnApplication } = require("../middlewares/memberAccess");

// P5 portal object authorization: a portal caller reaches only steps of its own application
// (middlewares/memberAccess.js crmOrOwnApplication); CRM keeps the existing PDP permission.

router.post(
  "/:applicationId",
  crmOrOwnApplication("portal", "create"),
  professionalDetailsController.createProfessionalDetails
);
router.get(
  "/",
  crmOrPortal("portal", "read"),
  professionalDetailsController.getMyProfessionalDetails
);
router.get(
  "/:applicationId",
  crmOrOwnApplication("portal", "read"),
  professionalDetailsController.getProfessionalDetails
);
router.put(
  "/:applicationId",
  crmOrOwnApplication("portal", "write"),
  professionalDetailsController.updateProfessionalDetails
);
router.delete(
  "/:applicationId",
  // Not a portal product flow (no portal / mobile caller): CRM + the existing permission only.
  requireCrm("portal", "delete"),
  professionalDetailsController.deleteProfessionalDetails
);

module.exports = router;

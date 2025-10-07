const express = require("express");
const router = express.Router();
const professionalDetailsController = require("../controllers/professional.details.controller");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");

router.post(
  "/:applicationId",
  defaultPolicyMiddleware.requirePermission("portal", "create"),
  professionalDetailsController.createProfessionalDetails
);
router.get(
  "/",
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  professionalDetailsController.getMyProfessionalDetails
);
router.get(
  "/:applicationId",
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  professionalDetailsController.getProfessionalDetails
);
router.put(
  "/:applicationId",
  defaultPolicyMiddleware.requirePermission("portal", "write"),
  professionalDetailsController.updateProfessionalDetails
);
router.delete(
  "/:applicationId",
  defaultPolicyMiddleware.requirePermission("portal", "delete"),
  professionalDetailsController.deleteProfessionalDetails
);

module.exports = router;

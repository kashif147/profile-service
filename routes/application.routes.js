const express = require("express");
const router = express.Router();
const applicationController = require("../controllers/application.controller");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");

router.get(
  "/",
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  applicationController.getAllApplications
);
router.get(
  "/:applicationId",
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  applicationController.getApplicationById
);
router.put(
  "/status/:applicationId",
  defaultPolicyMiddleware.requirePermission("portal", "write"),
  applicationController.approveApplication
);

module.exports = router;

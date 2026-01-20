const express = require("express");
const router = express.Router();
const applicationController = require("../controllers/application.controller");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");

// GET API - Original, unchanged
router.get(
  "/",
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  applicationController.getAllApplications
);

// NEW PUT API - Get applications with template filters and columns
router.put(
  "/filter",
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  applicationController.getApplicationsWithTemplate
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

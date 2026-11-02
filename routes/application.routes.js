const express = require("express");
const router = express.Router();
const applicationController = require("../controllers/application.controller");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");
const { requireCrm } = require("../middlewares/memberAccess");

// GET API - Original, unchanged
router.get(
  "/",
  requireCrm("application", "read"),
  applicationController.getAllApplications
);

// NEW PUT API - Get applications with template filters and columns
router.put(
  "/filter",
  requireCrm("application", "read"),
  applicationController.getApplicationsWithTemplate
);

router.get(
  "/me",
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  applicationController.getMyApplications
);

router.get(
  "/profile/:profileId",
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  applicationController.getApplicationsByProfileId
);

router.get(
  "/user",
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  applicationController.getApplicationsByUserId
);

router.get(
  "/:applicationId",
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  applicationController.getApplicationById
);

// Legacy approve/reject path: CRM administrative operation (P5).
router.put(
  "/status/:applicationId",
  requireCrm("application", "write"),
  applicationController.approveApplication
);

module.exports = router;

const express = require("express");
const router = express.Router();
const applicationFilterTemplateController = require("../controllers/application.filter.template.controller");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");

// Create a new filter template
router.post(
  "/",
  defaultPolicyMiddleware.requirePermission("portal", "write"),
  applicationFilterTemplateController.createTemplate
);

// Get all filter templates for the current user
router.get(
  "/",
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  applicationFilterTemplateController.getUserTemplates
);

// Get default template for the current user
router.get(
  "/default",
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  applicationFilterTemplateController.getDefaultTemplate
);

// Get a specific template by ID
router.get(
  "/:templateId",
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  applicationFilterTemplateController.getTemplateById
);

// Update a filter template
router.put(
  "/:templateId",
  defaultPolicyMiddleware.requirePermission("portal", "write"),
  applicationFilterTemplateController.updateTemplate
);

// Delete a filter template
router.delete(
  "/:templateId",
  defaultPolicyMiddleware.requirePermission("portal", "write"),
  applicationFilterTemplateController.deleteTemplate
);

module.exports = router;


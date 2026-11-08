const express = require("express");
const router = express.Router();
const batchController = require("../controllers/batch.controller");
const { authenticate } = require("../middlewares/auth");
const { requireCrm } = require("../middlewares/memberAccess");
// P5 prerequisite (blocker 1): batch delete is tenant-administrator only (middlewares/p5ActionGuards.js).
const { requireTenantAdmin } = require("../middlewares/p5ActionGuards");

// P5: batches hold member personal-data snapshots and creating/refreshing one rewrites profile
// records, so every route needs CRM + the exact catalogue permission for its action (read never
// authorizes create/mutation/delete). Known consequence, NOT role support: the PDP category rule
// currently refuses non-ASU CRM callers on the `profile` resource, so until the PDP consumer
// migration these routes are effectively ASU-only (own-tenant admin rule). No bypass is added here.

// Create a new batch (automatically populates with new members)
router.post("/", authenticate, requireCrm("profile", "write"), batchController.createBatch);

// Get all batches (with pagination and optional filters)
router.get("/", authenticate, requireCrm("profile", "read"), batchController.getAllBatches);

// Get a single batch by ID (member snapshot export)
router.get("/:batchId", authenticate, requireCrm("profile", "read"), batchController.getBatchById);

// Update a batch (name, description, isActive)
router.put("/:batchId", authenticate, requireCrm("profile", "write"), batchController.updateBatch);

// Delete a batch (soft delete; clears profile batchId)
router.delete("/:batchId", authenticate, requireCrm("profile", "delete"), requireTenantAdmin, batchController.deleteBatch);

// Refresh batch (re-fetch matching profiles)
router.post("/:batchId/refresh", authenticate, requireCrm("profile", "write"), batchController.refreshBatch);

module.exports = router;

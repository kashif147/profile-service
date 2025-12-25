const express = require("express");
const router = express.Router();
const batchController = require("../controllers/batch.controller");
const { authenticate } = require("../middlewares/auth");

// Create a new batch (automatically populates with new members)
router.post("/", authenticate, batchController.createBatch);

// Get all batches (with pagination and optional filters)
router.get("/", authenticate, batchController.getAllBatches);

// Get a single batch by ID
router.get("/:batchId", authenticate, batchController.getBatchById);

// Update a batch (name, description, isActive)
router.put("/:batchId", authenticate, batchController.updateBatch);

// Delete a batch (soft delete)
router.delete("/:batchId", authenticate, batchController.deleteBatch);

// Refresh batch (re-fetch matching profiles)
router.post("/:batchId/refresh", authenticate, batchController.refreshBatch);

module.exports = router;

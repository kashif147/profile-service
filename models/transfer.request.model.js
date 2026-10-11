const mongoose = require("mongoose");

const TransferRequestSchema = new mongoose.Schema(
  {
    // Stamped from the trusted request tenant on create. No default: a missing
    // tenant must fail validation rather than silently land in a fixed tenant.
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Profile",
      required: true,
    },
    currentWorkLocationId: {
      type: String,
      required: true,
    },
    requestedWorkLocationId: {
      type: String,
      required: true,
    },
    reason: {
      type: String,
    },
  
    requestDate: {
      type: Date,
    },
    transferDate: {
      type: Date,
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
  },
  { timestamps: true }
);

// Indexes for efficient queries
TransferRequestSchema.index({ tenantId: 1, status: 1 });
TransferRequestSchema.index({ userId: 1, status: 1 });
TransferRequestSchema.index({ tenantId: 1, userId: 1, status: 1 });

module.exports = mongoose.model(
  "TransferRequest",
  TransferRequestSchema
);


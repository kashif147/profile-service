const mongoose = require("mongoose");

const TransferRequestSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
      default: "39866a06-30bc-4a89-80c6-9dd9357dd453", // Default tenant
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
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

module.exports = mongoose.model(
  "TransferRequest",
  TransferRequestSchema
);


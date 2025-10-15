const mongoose = require("mongoose");
const ReviewOverlaySchema = new mongoose.Schema(
  {
    overlayId: { type: String, required: true, unique: true, index: true },
    applicationId: { type: String, required: true, index: true },
    tenantId: { type: String, index: true },
    reviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      index: true,
    },
    proposedPatch: { type: Array, default: [] }, // RFC 6902
    notes: String,
    decision: {
      type: String,
      enum: ["none", "approved", "rejected"],
      default: "none",
      index: true,
    },
    decisionReason: String,
    status: {
      type: String,
      enum: ["open", "decided"],
      default: "open",
      index: true,
    },
    overlayVersion: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: "overlayVersionKey" }
);
ReviewOverlaySchema.index({ applicationId: 1, status: 1 });
module.exports = mongoose.model("ReviewOverlay", ReviewOverlaySchema);

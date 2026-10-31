const mongoose = require("mongoose");

// Consumer-side dedupe for at-least-once events (payment-link listeners). Keyed on the
// producer's deterministic data.eventKey; kept 30 days.
const ProcessedEventSchema = new mongoose.Schema(
  {
    eventKey: { type: String, required: true },
    tenantId: { type: String, required: true },
    routingKey: { type: String },
    processedAt: { type: Date, default: Date.now },
  },
  { collection: "processedEvents" }
);

ProcessedEventSchema.index({ eventKey: 1 }, { unique: true });
ProcessedEventSchema.index({ processedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

module.exports =
  mongoose.models.ProcessedEvent || mongoose.model("ProcessedEvent", ProcessedEventSchema);

const mongoose = require("mongoose");

// Transactional-outbox row, published by services/outbox.service.js. eventKey is deterministic,
// so enqueueing the same fact twice stores it once and consumers dedupe on data.eventKey.
const OutboxEventSchema = new mongoose.Schema(
  {
    eventKey: { type: String, required: true },
    tenantId: { type: String, required: true },
    routingKey: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    correlationId: { type: String },
    status: { type: String, enum: ["PENDING", "PUBLISHED"], default: "PENDING" },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lastError: { type: String },
    publishedAt: { type: Date },
  },
  { timestamps: true, collection: "outboxEvents" }
);

OutboxEventSchema.index({ eventKey: 1 }, { unique: true });
OutboxEventSchema.index({ status: 1, nextAttemptAt: 1 });
OutboxEventSchema.index(
  { publishedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 3600, partialFilterExpression: { status: "PUBLISHED" } }
);

module.exports = mongoose.models.OutboxEvent || mongoose.model("OutboxEvent", OutboxEventSchema);

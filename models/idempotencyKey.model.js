const mongoose = require("mongoose");

// Persisted Idempotency-Key store (24 h). middlewares/idempotency.js is in-memory and not a
// production guarantee; this is. Same key + same request -> stored response; same key with a
// different request -> 422.
const IdempotencyKeySchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true },
    scope: { type: String, required: true },
    key: { type: String, required: true },
    requestHash: { type: String, required: true },
    state: { type: String, enum: ["IN_PROGRESS", "DONE"], default: "IN_PROGRESS" },
    response: {
      status: { type: Number },
      body: { type: mongoose.Schema.Types.Mixed },
    },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "idempotencyKeys" }
);

IdempotencyKeySchema.index({ tenantId: 1, scope: 1, key: 1 }, { unique: true });
IdempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 3600 });

module.exports =
  mongoose.models.IdempotencyKey || mongoose.model("IdempotencyKey", IdempotencyKeySchema);

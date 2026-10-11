const mongoose = require("mongoose");

/**
 * Per-tenant membership-number sequence (Phase 2B-PARALLEL-2, B5).
 * One row per (tenant, year letter); `seq` is the last number issued. Seeded from the
 * tenant's highest existing number for that letter, so existing numbers are preserved
 * and never reissued.
 */
const MembershipNumberSequenceSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, trim: true },
    yearAlphabet: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

MembershipNumberSequenceSchema.index({ tenantId: 1, yearAlphabet: 1 }, { unique: true });

module.exports = mongoose.model("MembershipNumberSequence", MembershipNumberSequenceSchema);

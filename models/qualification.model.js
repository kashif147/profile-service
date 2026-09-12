// A member's training/course-completion record - created automatically when
// events-service issues a certificate (events.certificate.issued.v1, already
// published by events-service's certificateIssuance.service.js for both
// manual and automatic issuance) - see
// rabbitMQ/listeners/certificateIssued.listener.js. Entirely new: no prior
// qualification/training-history concept existed here (only a flat, unrelated
// personalInfo.countryPrimaryQualification string, which country a member's
// PRIMARY nursing qualification came from - unrelated to CPD/event
// completions).
const mongoose = require("mongoose");

const QualificationSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    profileId: { type: String, required: true, index: true },
    source: { type: String, enum: ["event", "course"], required: true },
    eventId: { type: String, default: null },
    courseId: { type: String, default: null },
    registrationId: { type: String, required: true },
    certificateId: { type: String, default: null },
    title: { type: String, default: null }, // event/course title, for display without a cross-service lookup
    certificationType: { type: String, default: null },
    cpdCredits: { type: Number, default: null },
    accreditationBody: { type: String, default: null },
    issuedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Idempotency guard against events.certificate.issued.v1 redelivery - the
// listener upserts on this index rather than tracking a separate processed-
// events log.
QualificationSchema.index({ tenantId: 1, profileId: 1, registrationId: 1 }, { unique: true });

module.exports = mongoose.model("Qualification", QualificationSchema);

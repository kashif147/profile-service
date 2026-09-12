// Consumes events-service's events.certificate.issued.v1 (events.events
// exchange) and creates a Qualification record on the member's profile -
// reuses an event that already exists and already flows to notification-
// service today (in-app notification), rather than inventing a new one.
const Qualification = require("../../models/qualification.model.js");

async function handleCertificateIssued(payload) {
  const data = payload?.data || payload;
  const {
    tenantId,
    profileId,
    registrationId,
    certificateId,
    eventId,
    eventTitle,
    certificationType,
    cpdCredits,
    accreditationBody,
    issuedAt,
  } = data || {};

  if (!tenantId || !profileId || !registrationId) {
    console.warn("[profile-service] events.certificate.issued.v1: malformed payload - skipping", data);
    return;
  }

  // Upsert on the unique {tenantId, profileId, registrationId} index -
  // redelivery of the same event is a safe no-op, not a duplicate row.
  await Qualification.findOneAndUpdate(
    { tenantId, profileId, registrationId },
    {
      $setOnInsert: {
        tenantId,
        profileId,
        registrationId,
        source: "event",
        eventId: eventId || null,
        certificateId: certificateId || null,
        title: eventTitle || null,
        certificationType: certificationType || null,
        cpdCredits: cpdCredits ?? null,
        accreditationBody: accreditationBody || null,
        issuedAt: issuedAt ? new Date(issuedAt) : new Date(),
      },
    },
    { upsert: true, new: true },
  );
}

module.exports = { handleCertificateIssued };

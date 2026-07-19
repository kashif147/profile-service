const Profile = require("../models/profile.model.js");
const { normalizeEmail } = require("./profileLookup.service.js");
const {
  findCandidateDuplicateMatches,
} = require("../services/duplicate.detection.service.js");

/**
 * Minimal find-or-create for a Profile with NO membership number - used by the
 * events/courses registration flow (portal, mobile, CRM), which never goes through
 * the membership application/approval pipeline. Deliberately does not reuse
 * services/profileLookup.service.js or helpers/profileLookup.service.js's
 * findOrCreateProfileByEmail, which are coupled to the full application payload,
 * a Mongo transaction/session, and reviewer/portal-user linking.
 */
async function findOrCreateAttendeeProfile({
  tenantId,
  email,
  firstName,
  lastName,
  phone,
}) {
  if (!tenantId) throw new Error("tenantId is required");
  if (!email) throw new Error("email is required");

  const nEmail = normalizeEmail(email);

  const existing = await Profile.findOne({
    tenantId,
    normalizedEmail: nEmail,
  });
  if (existing) {
    return { profile: existing, created: false };
  }

  const candidateFields = {
    personalInfo: { forename: firstName || null, surname: lastName || null },
    contactInfo: {
      personalEmail: email,
      mobileNumber: phone || null,
      preferredEmail: "PERSONAL",
    },
  };

  let duplicateDetection;
  try {
    const result = await findCandidateDuplicateMatches(candidateFields, tenantId);
    const topMatch = result.matchSummary?.[0] || null;
    duplicateDetection = {
      isPotentialDuplicate: !!result.hasPotentialDuplicate,
      matchType: topMatch ? (topMatch.score === 100 ? "exact" : "fuzzy_scored") : null,
      matchedProfileIds: result.matchingProfiles.map((m) => m.sourceId),
      detectedAt: new Date(),
    };
  } catch (err) {
    console.error(
      "[attendeeProfileLookup] duplicate detection failed, continuing without a flag:",
      err.message,
    );
    duplicateDetection = undefined;
  }

  const profile = await Profile.create({
    tenantId,
    normalizedEmail: nEmail,
    // membershipNumber intentionally omitted - this is a non-member (attendee-only) profile
    personalInfo: { forename: firstName || null, surname: lastName || null },
    contactInfo: {
      personalEmail: email,
      mobileNumber: phone || null,
      preferredEmail: "PERSONAL",
    },
    submissionDate: new Date(),
    isActive: true,
    ...(duplicateDetection ? { duplicateDetection } : {}),
  });

  return { profile, created: true };
}

module.exports = { findOrCreateAttendeeProfile };

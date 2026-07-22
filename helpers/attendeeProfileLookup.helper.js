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

/**
 * Read-only duplicate check for a would-be new attendee - never creates a
 * Profile. Same exact-email fast path as findOrCreateAttendeeProfile, but
 * when there's no exact email match it surfaces fuzzy candidates (via the
 * same scoring engine used for membership-application duplicate review)
 * instead of silently letting the caller create a new Profile:
 *   - "exact": an existing Profile with this exact email - reuse it.
 *   - "review": no exact email match, but one or more Profiles scored as a
 *     likely match (score >= 40) - the caller must resolve this (pick one of
 *     the candidates, or explicitly confirm creating a new Profile) before
 *     registering the attendee.
 *   - "none": no match at all - safe to create a new Profile.
 */
async function checkAttendeeDuplicates({ tenantId, email, firstName, lastName, phone }) {
  if (!tenantId) throw new Error("tenantId is required");
  if (!email) throw new Error("email is required");

  const nEmail = normalizeEmail(email);
  const existing = await Profile.findOne({ tenantId, normalizedEmail: nEmail });
  if (existing) {
    return {
      resolution: "exact",
      profileId: existing._id.toString(),
      membershipNumber: existing.membershipNumber || null,
    };
  }

  const candidateFields = {
    personalInfo: { forename: firstName || null, surname: lastName || null },
    contactInfo: {
      personalEmail: email,
      mobileNumber: phone || null,
      preferredEmail: "PERSONAL",
    },
  };
  const result = await findCandidateDuplicateMatches(candidateFields, tenantId);
  const candidates = (result.matchSummary || []).filter((m) => m.score >= 40);
  if (!candidates.length) {
    return { resolution: "none" };
  }

  return {
    resolution: "review",
    candidates: candidates.map((m) => ({
      profileId: m.sourceId,
      membershipNumber: m.membershipNumber || null,
      name: m.name,
      email: m.email,
      score: m.score,
      classification: m.classification,
    })),
  };
}

module.exports = { findOrCreateAttendeeProfile, checkAttendeeDuplicates };

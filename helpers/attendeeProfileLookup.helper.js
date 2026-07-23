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
// Builds the contactInfo/professionalDetails sub-documents shared by the
// create path and the duplicate-detection candidate record, so an attendee's
// work location, grade, and address (collected on the CRM form) actually
// land on the Profile instead of being silently dropped.
function buildAttendeeProfileFields({
  email,
  phone,
  workLocation,
  grade,
  addressLine1,
  addressLine2,
  townCity,
  countyState,
  eircode,
  country,
}) {
  return {
    contactInfo: {
      personalEmail: email,
      mobileNumber: phone || null,
      preferredEmail: "PERSONAL",
      buildingOrHouse: addressLine1 || null,
      streetOrRoad: addressLine2 || null,
      areaOrTown: townCity || null,
      countyCityOrPostCode: countyState || null,
      eircode: eircode || null,
      country: country || null,
    },
    professionalDetails: {
      workLocation: workLocation || null,
      grade: grade || null,
    },
  };
}

async function findOrCreateAttendeeProfile({
  tenantId,
  email,
  firstName,
  lastName,
  phone,
  workLocation,
  grade,
  addressLine1,
  addressLine2,
  townCity,
  countyState,
  eircode,
  country,
}) {
  if (!tenantId) throw new Error("tenantId is required");
  if (!email) throw new Error("email is required");

  const nEmail = normalizeEmail(email);

  const existing = await Profile.findOne({
    tenantId,
    normalizedEmail: nEmail,
  });
  if (existing) {
    // Backfill only the blanks - an existing profile's own data always wins,
    // but attendee-only profiles often have no contactInfo/professionalDetails
    // yet, so what's collected on this registration form shouldn't be dropped.
    const { contactInfo: newContactInfo, professionalDetails: newProfessionalDetails } =
      buildAttendeeProfileFields({
        email,
        phone,
        workLocation,
        grade,
        addressLine1,
        addressLine2,
        townCity,
        countyState,
        eircode,
        country,
      });
    let changed = false;
    existing.contactInfo = existing.contactInfo || {};
    existing.professionalDetails = existing.professionalDetails || {};
    for (const [key, value] of Object.entries(newContactInfo)) {
      if (value && !existing.contactInfo[key]) {
        existing.contactInfo[key] = value;
        changed = true;
      }
    }
    for (const [key, value] of Object.entries(newProfessionalDetails)) {
      if (value && !existing.professionalDetails[key]) {
        existing.professionalDetails[key] = value;
        changed = true;
      }
    }
    if (changed) {
      existing.markModified("contactInfo");
      existing.markModified("professionalDetails");
      await existing.save();
    }
    return { profile: existing, created: false };
  }

  const { contactInfo, professionalDetails } = buildAttendeeProfileFields({
    email,
    phone,
    workLocation,
    grade,
    addressLine1,
    addressLine2,
    townCity,
    countyState,
    eircode,
    country,
  });
  const candidateFields = {
    personalInfo: { forename: firstName || null, surname: lastName || null },
    contactInfo,
    professionalDetails,
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
    contactInfo,
    professionalDetails,
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
async function checkAttendeeDuplicates({
  tenantId,
  email,
  firstName,
  lastName,
  phone,
  addressLine1,
  townCity,
  countyState,
  eircode,
  country,
}) {
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

  const { contactInfo } = buildAttendeeProfileFields({
    email,
    phone,
    addressLine1,
    townCity,
    countyState,
    eircode,
    country,
  });
  const candidateFields = {
    personalInfo: { forename: firstName || null, surname: lastName || null },
    contactInfo,
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

/**
 * Compensating rollback for a Profile this same request just created via
 * findOrCreateAttendeeProfile - used when a LATER step of the same
 * registration attempt fails (e.g. payment intent creation), so a failed
 * registration never leaves a half-created Profile behind. Refuses to touch
 * any profile that has a membershipNumber - a real member profile must never
 * be deleted by this path, even if called with a stale/wrong id.
 */
async function deleteAttendeeProfile({ tenantId, profileId }) {
  if (!tenantId || !profileId) return { deleted: false, reason: "missing_params" };
  const profile = await Profile.findOne({ _id: profileId, tenantId });
  if (!profile) return { deleted: false, reason: "not_found" };
  if (profile.membershipNumber) return { deleted: false, reason: "has_membership_number" };
  await Profile.deleteOne({ _id: profileId, tenantId });
  return { deleted: true };
}

module.exports = { findOrCreateAttendeeProfile, checkAttendeeDuplicates, deleteAttendeeProfile };

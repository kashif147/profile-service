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
  nmbiNumber,
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
      nmbiNumber: nmbiNumber || null,
    },
  };
}

async function findOrCreateAttendeeProfile({
  tenantId,
  email,
  title,
  firstName,
  lastName,
  gender,
  dateOfBirth,
  phone,
  workLocation,
  grade,
  nmbiNumber,
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
    // but attendee-only profiles often have no contactInfo/professionalDetails/
    // personalInfo yet, so what's collected on this registration form
    // shouldn't be dropped.
    const { contactInfo: newContactInfo, professionalDetails: newProfessionalDetails } =
      buildAttendeeProfileFields({
        email,
        phone,
        workLocation,
        grade,
        nmbiNumber,
        addressLine1,
        addressLine2,
        townCity,
        countyState,
        eircode,
        country,
      });
    const newPersonalInfo = { title: title || null, gender: gender || null, dateOfBirth: dateOfBirth || null };
    let changed = false;
    existing.contactInfo = existing.contactInfo || {};
    existing.professionalDetails = existing.professionalDetails || {};
    existing.personalInfo = existing.personalInfo || {};
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
    for (const [key, value] of Object.entries(newPersonalInfo)) {
      if (value && !existing.personalInfo[key]) {
        existing.personalInfo[key] = value;
        changed = true;
      }
    }
    if (changed) {
      existing.markModified("contactInfo");
      existing.markModified("professionalDetails");
      existing.markModified("personalInfo");
      await existing.save();
    }
    return { profile: existing, created: false };
  }

  const { contactInfo, professionalDetails } = buildAttendeeProfileFields({
    email,
    phone,
    workLocation,
    grade,
    nmbiNumber,
    addressLine1,
    addressLine2,
    townCity,
    countyState,
    eircode,
    country,
  });
  const personalInfo = {
    title: title || null,
    forename: firstName || null,
    surname: lastName || null,
    gender: gender || null,
    dateOfBirth: dateOfBirth || null,
  };
  const candidateFields = {
    personalInfo,
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
    personalInfo,
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
  nmbiNumber,
  dateOfBirth,
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

  const { contactInfo, professionalDetails } = buildAttendeeProfileFields({
    email,
    phone,
    nmbiNumber,
    addressLine1,
    townCity,
    countyState,
    eircode,
    country,
  });
  const candidateFields = {
    personalInfo: { forename: firstName || null, surname: lastName || null, dateOfBirth: dateOfBirth || null },
    contactInfo,
    professionalDetails,
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
 * Fill in blank professionalDetails.nmbiNumber / personalInfo.title,gender,
 * dateOfBirth on an ALREADY-RESOLVED profile (the CRM "search and select an
 * existing profile", or a registration whose email exactly matched an
 * existing profile, attendee-registration paths - both go straight to a
 * known profileId and never go through findOrCreateAttendeeProfile's own
 * by-email backfill above). Never overwrites a value that's already set -
 * each field is only written when it's currently null/empty/missing on the
 * profile, so this can't clobber real data even under a concurrent call.
 */
async function syncAttendeeProfileFields({ tenantId, profileId, nmbiNumber, title, gender, dateOfBirth }) {
  if (!tenantId || !profileId) {
    return { updated: false, reason: "missing_params" };
  }
  if (!nmbiNumber && !title && !gender && !dateOfBirth) {
    return { updated: false, reason: "missing_params" };
  }

  const profile = await Profile.findOne({ _id: profileId, tenantId });
  if (!profile) {
    return { updated: false, reason: "not_found" };
  }

  profile.professionalDetails = profile.professionalDetails || {};
  profile.personalInfo = profile.personalInfo || {};

  let changed = false;
  if (nmbiNumber && !profile.professionalDetails.nmbiNumber) {
    profile.professionalDetails.nmbiNumber = nmbiNumber;
    changed = true;
  }
  if (title && !profile.personalInfo.title) {
    profile.personalInfo.title = title;
    changed = true;
  }
  if (gender && !profile.personalInfo.gender) {
    profile.personalInfo.gender = gender;
    changed = true;
  }
  if (dateOfBirth && !profile.personalInfo.dateOfBirth) {
    profile.personalInfo.dateOfBirth = dateOfBirth;
    changed = true;
  }

  if (!changed) {
    return { updated: false, reason: "no_blank_fields" };
  }

  profile.markModified("professionalDetails");
  profile.markModified("personalInfo");
  await profile.save();
  return { updated: true };
}

/**
 * Real, unconditional edit of an already-linked attendee Profile's
 * personalInfo/contactInfo/professionalDetails fields - used when a CRM user
 * edits an existing registration's attendee details (unlike
 * syncAttendeeProfileFields above, which only ever fills in a currently-blank
 * value, this OVERWRITES whatever the CRM user submitted). Only touches a
 * field when its key is present in the call (`!== undefined`), so a caller
 * can send a partial edit without wiping out fields it didn't intend to
 * touch. An email edit that would collide with another profile's
 * normalizedEmail in the same tenant throws rather than silently failing at
 * save time with an opaque Mongo E11000.
 */
async function updateAttendeeProfileFields({
  tenantId,
  profileId,
  title,
  firstName,
  lastName,
  gender,
  dateOfBirth,
  email,
  phone,
  workLocation,
  grade,
  nmbiNumber,
  addressLine1,
  addressLine2,
  townCity,
  countyState,
  eircode,
  country,
}) {
  if (!tenantId || !profileId) throw new Error("tenantId and profileId are required");

  const profile = await Profile.findOne({ _id: profileId, tenantId });
  if (!profile) {
    return { updated: false, reason: "not_found" };
  }

  profile.personalInfo = profile.personalInfo || {};
  profile.contactInfo = profile.contactInfo || {};
  profile.professionalDetails = profile.professionalDetails || {};

  if (title !== undefined) profile.personalInfo.title = title || null;
  if (firstName !== undefined) profile.personalInfo.forename = firstName || null;
  if (lastName !== undefined) profile.personalInfo.surname = lastName || null;
  if (gender !== undefined) profile.personalInfo.gender = gender || null;
  if (dateOfBirth !== undefined) profile.personalInfo.dateOfBirth = dateOfBirth || null;

  if (email !== undefined && email) {
    const nEmail = normalizeEmail(email);
    if (nEmail && nEmail !== profile.normalizedEmail) {
      const collision = await Profile.findOne({
        tenantId,
        normalizedEmail: nEmail,
        _id: { $ne: profile._id },
      });
      if (collision) {
        const err = new Error("Another profile already uses this email address");
        err.code = "ATTENDEE_EMAIL_CONFLICT";
        throw err;
      }
      profile.normalizedEmail = nEmail;
    }
    profile.contactInfo.personalEmail = email;
  }
  if (phone !== undefined) profile.contactInfo.mobileNumber = phone || null;
  if (addressLine1 !== undefined) profile.contactInfo.buildingOrHouse = addressLine1 || null;
  if (addressLine2 !== undefined) profile.contactInfo.streetOrRoad = addressLine2 || null;
  if (townCity !== undefined) profile.contactInfo.areaOrTown = townCity || null;
  if (countyState !== undefined) profile.contactInfo.countyCityOrPostCode = countyState || null;
  if (eircode !== undefined) profile.contactInfo.eircode = eircode || null;
  if (country !== undefined) profile.contactInfo.country = country || null;

  if (workLocation !== undefined) profile.professionalDetails.workLocation = workLocation || null;
  if (grade !== undefined) profile.professionalDetails.grade = grade || null;
  if (nmbiNumber !== undefined) profile.professionalDetails.nmbiNumber = nmbiNumber || null;

  profile.markModified("personalInfo");
  profile.markModified("contactInfo");
  profile.markModified("professionalDetails");
  await profile.save();

  return { updated: true, profileId: profile._id.toString() };
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

module.exports = {
  findOrCreateAttendeeProfile,
  checkAttendeeDuplicates,
  syncAttendeeProfileFields,
  updateAttendeeProfileFields,
  deleteAttendeeProfile,
};

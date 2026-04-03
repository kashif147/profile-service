const Profile = require("../models/profile.model.js");
const User = require("../models/user.model.js");
const { flattenProfilePayload } = require("../helpers/profile.transform.js");
const {
  generateMembershipNumber,
} = require("../helpers/membership.number.generator.js");

// Helper function to handle bypass user ObjectId conversion
function getReviewerIdForDb(reviewerId) {
  if (reviewerId === "bypass-user") {
    return null; // Allow null for bypass users
  }
  return reviewerId;
}
function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}
function pickPrimaryEmail(contactInfo = {}) {
  const pref = contactInfo?.preferredEmail;
  if (pref === "PERSONAL" && contactInfo.personalEmail)
    return contactInfo.personalEmail;
  if (pref === "WORK" && contactInfo.workEmail) return contactInfo.workEmail;
  return contactInfo.personalEmail || contactInfo.workEmail || null;
}

/**
 * Synced portal User row in profile-service (from user.portal.* events).
 * userEmail is stored lowercase — pass normalized email.
 */
async function findPortalUserIdByTenantEmail(tenantId, normalizedEmail, session) {
  if (!tenantId || !normalizedEmail) return null;
  let q = User.findOne({
    tenantId,
    userEmail: normalizedEmail,
    userType: "PORTAL",
    isActive: true,
  });
  if (session) q = q.session(session);
  const existingUser = await q.lean();
  const portalUserId = existingUser?.userId || null;
  if (portalUserId) {
    console.log(
      `✅ [profileLookup] Found portal user for email ${normalizedEmail}: ${portalUserId}`
    );
  }
  return portalUserId;
}

/** Prefer submission portal user id; else link from synced User collection by email. */
function resolveLinkedPortalUserIdForProfile(
  userType,
  submissionUserId,
  portalUserIdFromDb
) {
  if (userType === "PORTAL" && submissionUserId) return submissionUserId;
  if (portalUserIdFromDb) return portalUserIdFromDb;
  return null;
}

async function findOrCreateProfileByEmail({
  tenantId,
  effective,
  reviewerId,
  session,
}) {
  const contactInfo = effective?.contactInfo || {};
  const email = pickPrimaryEmail(contactInfo);
  if (!email)
    throw Object.assign(new Error("Primary email required to approve"), {
      status: 400,
    });
  const nEmail = normalizeEmail(email);

  // Get userId and userType from effective (from submission data)
  const userId = effective?.userId || null;
  const userType = effective?.userType || null;

  const portalUserId = await findPortalUserIdByTenantEmail(
    tenantId,
    nEmail,
    session
  );
  const linkedUserId = resolveLinkedPortalUserIdForProfile(
    userType,
    userId,
    portalUserId
  );
  if (!portalUserId && !linkedUserId) {
    console.log(
      `ℹ️ [profileLookup] No portal user in User collection for ${nEmail}; Profile.userId may stay null until user.portal.* sync`
    );
  }

  let profile = await Profile.findOne({
    tenantId,
    normalizedEmail: nEmail,
  }).session(session);
  if (!profile) {
    const flattened = flattenProfilePayload(effective);
    const now = new Date();
    // Use dateJoined from approval if available, otherwise use current date
    const firstJoinedDate = effective.subscriptionDetails?.dateJoined
      ? new Date(effective.subscriptionDetails.dateJoined)
      : now;

    // Generate membership number for new profile
    const membershipNumber = await generateMembershipNumber();

    const doc = {
      tenantId,
      normalizedEmail: nEmail,
      personalInfo: flattened.personalInfo || {},
      contactInfo: flattened.contactInfo || {},
      professionalDetails: flattened.professionalDetails || {},
      preferences: flattened.preferences || {},
      cornMarket: flattened.cornMarket || {},
      additionalInformation: flattened.additionalInformation || {},
      recruitmentDetails: flattened.recruitmentDetails || {},
      membershipNumber: membershipNumber, // Auto-generated membership number for new profile
      firstJoinedDate: firstJoinedDate, // Use dateJoined from approval
      currentSubscriptionId: null,
      hasHistory: false,
      submissionDate: now,
    };

    if (linkedUserId) {
      doc.userId = linkedUserId;
    }

    // Set crmUserId when reviewerId is provided (CRM user approving the profile)
    if (reviewerId) {
      doc.crmUserId = getReviewerIdForDb(reviewerId);
    }

    profile = await Profile.create([doc], { session }).then((x) => x[0]);
    console.log(
      `✅ Generated membership number ${membershipNumber} for new profile ${profile._id}`
    );
  } else {
    const flattened = flattenProfilePayload(effective);
    const $set = {
      personalInfo: flattened.personalInfo || {},
      contactInfo: flattened.contactInfo || {},
      professionalDetails: flattened.professionalDetails || {},
      preferences: flattened.preferences || {},
      cornMarket: flattened.cornMarket || {},
      additionalInformation: flattened.additionalInformation || {},
      recruitmentDetails: flattened.recruitmentDetails || {},
    };

    if (!profile.userId && linkedUserId) {
      $set.userId = linkedUserId;
    }

    // Set crmUserId when reviewerId is provided (CRM user approving the profile)
    if (reviewerId) {
      $set.crmUserId = getReviewerIdForDb(reviewerId);
    }

    // Update normalizedEmail based on preferred email
    const existingContactInfo = profile.contactInfo?.toObject
      ? profile.contactInfo.toObject()
      : profile.contactInfo || {};
    const updatedContactInfo = {
      ...existingContactInfo,
      ...flattened.contactInfo,
    };
    const primaryEmail = pickPrimaryEmail(updatedContactInfo);
    if (primaryEmail) {
      $set.normalizedEmail = normalizeEmail(primaryEmail);
    }

    await Profile.updateOne({ _id: profile._id }, { $set }, { session });
  }
  return { profile, portalUserId, linkedUserId };
}

module.exports = {
  normalizeEmail,
  pickPrimaryEmail,
  findPortalUserIdByTenantEmail,
  resolveLinkedPortalUserIdForProfile,
  findOrCreateProfileByEmail,
};

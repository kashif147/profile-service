// services/profileLookup.service.js
const Profile = require("../models/profile.model.js");
const { flattenProfilePayload } = require("./profile.transform.js");
const { generateMembershipNumber } = require("./membership.number.generator.js");

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
  // choose personalEmail/workEmail based on preferredEmail, then fallback
  const pref = contactInfo?.preferredEmail;
  if (pref === "PERSONAL" && contactInfo.personalEmail)
    return contactInfo.personalEmail;
  if (pref === "WORK" && contactInfo.workEmail) return contactInfo.workEmail;
  return contactInfo.personalEmail || contactInfo.workEmail || null;
}

/**
 * Find or create a profile by normalized email.
 * Does NOT overwrite identity fields if already present; fills blanks only.
 */
async function findOrCreateProfileByEmail({
  tenantId,
  effective,
  reviewerId,
  session,
}) {
  const contactInfo = effective?.contactInfo || {};
  const flattenedProfileFields = flattenProfilePayload(effective);

  const email = pickPrimaryEmail(contactInfo);
  if (!email) {
    throw new Error("Cannot approve without a primary email address");
  }
  const nEmail = normalizeEmail(email);

  let profile = await Profile.findOne({
    tenantId,
    normalizedEmail: nEmail,
  }).session(session);

  if (!profile) {
    // Generate membership number for new profile
    const membershipNumber = await generateMembershipNumber();
    
    profile = await Profile.create(
      [
        {
          tenantId,
          email,
          normalizedEmail: nEmail,
          ...flattenedProfileFields,
          membershipNumber: membershipNumber, // Auto-generated membership number for new profile
          crmUserId: getReviewerIdForDb(reviewerId), // ID of the CRM user who approved this profile
          applicationStatus: "APPROVED",
          approvalDetails: {
            approvedBy: getReviewerIdForDb(reviewerId),
            approvedAt: new Date(),
          },
        },
      ],
      { session }
    ).then((arr) => arr[0]);
    console.log(`✅ Generated membership number ${membershipNumber} for new profile ${profile._id}`);
  } else {
    // Update profile fields conservatively: fill if blank, refresh core payloads
    const $set = {
      ...flattenedProfileFields,
      crmUserId: getReviewerIdForDb(reviewerId), // ID of the CRM user who approved this profile
      applicationStatus: "APPROVED",
      "approvalDetails.approvedBy": getReviewerIdForDb(reviewerId),
      "approvalDetails.approvedAt": new Date(),
    };
    
    // Update normalizedEmail based on preferred email
    const existingContactInfo = profile.contactInfo?.toObject ? profile.contactInfo.toObject() : (profile.contactInfo || {});
    const updatedContactInfo = { ...existingContactInfo, ...flattenedProfileFields.contactInfo };
    const primaryEmail = pickPrimaryEmail(updatedContactInfo);
    if (primaryEmail) {
      $set.normalizedEmail = normalizeEmail(primaryEmail);
    }
    
    await Profile.updateOne({ _id: profile._id }, { $set }, { session });
  }

  return profile;
}

module.exports = {
  normalizeEmail,
  pickPrimaryEmail,
  findOrCreateProfileByEmail,
};

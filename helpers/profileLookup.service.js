// services/profileLookup.service.js
const Profile = require("../models/profile.model.js");

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
  const personalInfo = effective?.personalInfo || {};

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
    profile = await Profile.create(
      [
        {
          tenantId,
          email,
          normalizedEmail: nEmail,
          mobileNumber: contactInfo.mobileNumber || null,
          surname: personalInfo.surname || null,
          forename: personalInfo.forename || null,
          dateOfBirth: personalInfo.dateOfBirth || null,
          addressLine1:
            contactInfo.buildingOrHouse || contactInfo.streetOrRoad || null,
          personalInfo: effective.personalInfo || {},
          contactInfo: effective.contactInfo || {},
          professionalDetails: effective.professionalDetails || {},
          subscriptionAttributes: {}, // set below by caller if needed
          applicationStatus: "APPROVED",
          approvalDetails: {
            approvedBy: reviewerId,
            approvedAt: new Date(),
          },
        },
      ],
      { session }
    ).then((arr) => arr[0]);
  } else {
    // Update profile fields conservatively: fill if blank, refresh core payloads
    const $set = {
      personalInfo: effective.personalInfo || {},
      contactInfo: effective.contactInfo || {},
      professionalDetails: effective.professionalDetails || {},
      applicationStatus: "APPROVED",
      "approvalDetails.approvedBy": reviewerId,
      "approvalDetails.approvedAt": new Date(),
    };
    if (!profile.mobileNumber && contactInfo.mobileNumber)
      $set.mobileNumber = contactInfo.mobileNumber;
    if (!profile.surname && personalInfo.surname)
      $set.surname = personalInfo.surname;
    if (!profile.forename && personalInfo.forename)
      $set.forename = personalInfo.forename;
    if (!profile.dateOfBirth && personalInfo.dateOfBirth)
      $set.dateOfBirth = personalInfo.dateOfBirth;
    if (
      !profile.addressLine1 &&
      (contactInfo.buildingOrHouse || contactInfo.streetOrRoad)
    ) {
      $set.addressLine1 =
        contactInfo.buildingOrHouse || contactInfo.streetOrRoad;
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

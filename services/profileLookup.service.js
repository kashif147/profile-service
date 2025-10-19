const Profile = require("../models/profile.model.js");

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
async function findOrCreateProfileByEmail({
  tenantId,
  effective,
  reviewerId,
  session,
}) {
  const contactInfo = effective?.contactInfo || {};
  const personalInfo = effective?.personalInfo || {};
  const email = pickPrimaryEmail(contactInfo);
  if (!email)
    throw Object.assign(new Error("Primary email required to approve"), {
      status: 400,
    });
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
          applicationStatus: "APPROVED",
          approvalDetails: {
            approvedBy: getReviewerIdForDb(reviewerId),
            approvedAt: new Date(),
          },
        },
      ],
      { session }
    ).then((x) => x[0]);
  } else {
    const $set = {
      personalInfo: effective.personalInfo || {},
      contactInfo: effective.contactInfo || {},
      professionalDetails: effective.professionalDetails || {},
      applicationStatus: "APPROVED",
      "approvalDetails.approvedBy": getReviewerIdForDb(reviewerId),
      "approvalDetails.approvedAt": new Date(),
    };
    await Profile.updateOne({ _id: profile._id }, { $set }, { session });
  }
  return profile;
}

module.exports = {
  normalizeEmail,
  pickPrimaryEmail,
  findOrCreateProfileByEmail,
};

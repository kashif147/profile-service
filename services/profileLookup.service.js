const Profile = require("../models/profile.model.js");
const { flattenProfilePayload } = require("../helpers/profile.transform.js");
const { generateMembershipNumber } = require("../helpers/membership.number.generator.js");

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
		const flattened = flattenProfilePayload(effective);
		const now = new Date();
		
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
			firstJoinedDate: null, // set below when appropriate
			currentSubscriptionId: null,
			hasHistory: false,
			submissionDate: now,
		};
		// first-ever membership: set firstJoinedDate once
		doc.firstJoinedDate = now;
		profile = await Profile.create([doc], { session }).then((x) => x[0]);
		console.log(`✅ Generated membership number ${membershipNumber} for new profile ${profile._id}`);
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
		
		// Update normalizedEmail based on preferred email
		const existingContactInfo = profile.contactInfo?.toObject ? profile.contactInfo.toObject() : (profile.contactInfo || {});
		const updatedContactInfo = { ...existingContactInfo, ...flattened.contactInfo };
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

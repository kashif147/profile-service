const Profile = require("../models/profile.model.js");
const User = require("../models/user.model.js");
const { flattenProfilePayload } = require("../helpers/profile.transform.js");
const {
  generateMembershipNumber,
} = require("../helpers/membership.number.generator.js");
const { parseDateOnlyToUtcNoon } = require("../helpers/parseDateOnly.js");
const { AppError } = require("../errors/AppError.js");
const {
  getReviewerIdForDb,
  toObjectIdOrNull,
} = require("../helpers/reviewerIdForDb.js");

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
  const existingUser = await findPortalUserByTenantEmail(
    tenantId,
    normalizedEmail,
    session
  );
  return existingUser?.userId || null;
}

async function findPortalUserByTenantEmail(tenantId, normalizedEmail, session) {
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
  return existingUser || null;
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
  if (!email) {
    throw AppError.badRequest("Primary email required to approve");
  }
  const nEmail = normalizeEmail(email);

  // Get userId and userType from effective (from submission data)
  const userId = effective?.userId || null;
  const userType = effective?.userType || null;

  const portalUser = await findPortalUserByTenantEmail(
    tenantId,
    nEmail,
    session
  );
  const portalUserId = portalUser?.userId || null;
  const portalUserDocumentId = portalUser?._id || null;
  const linkedUserId = resolveLinkedPortalUserIdForProfile(
    userType,
    userId,
    portalUserId
  );
  const linkedUserDocumentId =
    portalUserDocumentId ||
    (linkedUserId ? toObjectIdOrNull(linkedUserId) : null);
  if (!portalUserId && !linkedUserId) {
    console.log(
      `ℹ️ [profileLookup] No portal user in User collection for ${nEmail}; Profile.userId may stay null until user.portal.* sync`
    );
  }

  let identityLink = null;
  let profile = await Profile.findOne({
    tenantId,
    normalizedEmail: nEmail,
  }).session(session);
  if (!profile) {
    const flattened = flattenProfilePayload(effective);
    const now = new Date();
    // Use dateJoined from approval if available, otherwise use current date
    const firstJoinedDate = effective.subscriptionDetails?.dateJoined
      ? parseDateOnlyToUtcNoon(effective.subscriptionDetails.dateJoined, true)
      : parseDateOnlyToUtcNoon(null, true);
    const submissionDate =
      effective.subscriptionDetails?.submissionDate != null
        ? parseDateOnlyToUtcNoon(effective.subscriptionDetails.submissionDate, false)
        : now;

    // Generate membership number for new profile
    const membershipNumber = await generateMembershipNumber(tenantId);

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
      submissionDate,
    };

    if (linkedUserDocumentId) {
      doc.userId = linkedUserDocumentId;
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

    // P5 identity (owner policy): an EXISTING profile is never bound to a portal user because its
    // email matched - bound to someone else or unbound. Only a profile already bound to this same
    // applicant is updated as that user's own (incl. normalizedEmail); otherwise its identity
    // contact emails and normalizedEmail stay, and a pending identity-link request is recorded.
    const applicantIds = [
      linkedUserDocumentId ? String(linkedUserDocumentId) : null,
      linkedUserId ? String(linkedUserId) : null,
    ].filter(Boolean);
    const boundToApplicant = !!profile.userId && applicantIds.includes(String(profile.userId));
    if (!boundToApplicant) {
      identityLink = pendingIdentityLink({ profile, applicantIds });
      $set.contactInfo = preserveIdentityContact(profile.contactInfo, $set.contactInfo);
    }

    // crmUserId (CRM user who approved this profile) is an identity binding: set once, never
    // overwritten by a later approval (P5).
    if (reviewerId && !profile.crmUserId) {
      $set.crmUserId = getReviewerIdForDb(reviewerId);
    }

    // normalizedEmail follows the preferred email only for the profile's own (same) user.
    if (boundToApplicant) {
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
    }

    // This branch also runs for a pre-existing membershipNumber-less Profile
    // (e.g. events-service's find-or-create-attendee Profile - attending an
    // event never made someone a member, so that Profile was created with no
    // membership number) that is only now, via this application approval,
    // actually becoming a member. Without this, approveApplication's
    // memberId (= profile.membershipNumber) stays null downstream, which
    // breaks the member-created/subscription-upsert events - mirrors the
    // same check bulkApproval.controller.js already has for its own
    // "existing profile" branch.
    if (!profile.membershipNumber) {
      const membershipNumber = await generateMembershipNumber(profile.tenantId);
      $set.membershipNumber = membershipNumber;
      console.log(
        `✅ Generated membership number ${membershipNumber} for existing profile ${profile._id}`,
      );
    }

    await Profile.updateOne({ _id: profile._id }, { $set }, { session });
    // profile.updated for reporting is published after commit via publishPostApprovalEvents
  }
  return {
    profile,
    portalUserId,
    linkedUserId: linkedUserDocumentId,
    sourceUserId: linkedUserId,
    identityLink,
  };
}

const { pendingIdentityLink, preserveIdentityContact } = require("./approvalIdentityLink.js");

module.exports = {
  normalizeEmail,
  pickPrimaryEmail,
  findPortalUserByTenantEmail,
  findPortalUserIdByTenantEmail,
  resolveLinkedPortalUserIdForProfile,
  findOrCreateProfileByEmail,
};

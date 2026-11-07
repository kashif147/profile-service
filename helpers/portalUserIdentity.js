const mongoose = require("mongoose");
const User = require("../models/user.model.js");

async function resolvePortalUserServiceId({
  tenantId,
  profileUserId,
  linkedUserId,
  userEmail,
}) {
  if (tenantId && profileUserId) {
    const syncedUser = await User.findOne({
      _id: profileUserId,
      tenantId,
      userType: "PORTAL",
      isActive: true,
    })
      .select("userId")
      .lean();
    if (syncedUser?.userId) {
      return String(syncedUser.userId);
    }
  }

  if (tenantId && linkedUserId) {
    const syncedUser = await User.findOne({
      tenantId,
      userId: String(linkedUserId),
      userType: "PORTAL",
      isActive: true,
    })
      .select("userId")
      .lean();
    if (syncedUser?.userId) {
      return String(syncedUser.userId);
    }
  }

  if (tenantId && userEmail) {
    const syncedUser = await User.findOne({
      tenantId,
      userEmail: String(userEmail).trim().toLowerCase(),
      userType: "PORTAL",
      isActive: true,
    })
      .select("userId")
      .lean();
    if (syncedUser?.userId) {
      return String(syncedUser.userId);
    }
  }

  return linkedUserId != null
    ? String(linkedUserId)
    : profileUserId != null
      ? String(profileUserId)
      : null;
}

/**
 * P5 identity: an application submitted by an authenticated portal user. Same rule as the create
 * listener (isPortalOriginatedApplication): meta.userType PORTAL, or unset, with the submitter's id.
 */
function isPortalSubmitted(userType, submitterUserId) {
  if (submitterUserId == null || String(submitterUserId).trim() === "") return false;
  return userType == null || userType === "" || String(userType).toUpperCase() === "PORTAL";
}

/**
 * P5 identity: the user-service id that an application's side effects (approval / rejection events,
 * the member role grant, notifications, subscription user) are addressed to.
 *  - Portal-submitted: THAT submitter - their own synced User row's userId (matched by user id or the
 *    row's _id), else the verified id itself. Never the profile's bound user, never an email match.
 *    identityLinkPending (approval landed on an existing profile bound to someone else): no
 *    recipient (userId null, pending) until the identity link is decided - the applicant must not be
 *    attached to that profile's subscription or member events, and nobody else may be.
 *  - CRM-created (no portal submitter): the existing resolution (profile row -> linked id -> email).
 * Returns { userId, applicantIdentity: { source, verified, pending } }.
 */
async function resolveApplicationRecipient({
  tenantId,
  submitterUserId,
  submitterUserType,
  profileUserId,
  linkedUserId,
  userEmail,
  identityLinkPending = false,
}) {
  if (isPortalSubmitted(submitterUserType, submitterUserId)) {
    if (identityLinkPending) {
      return {
        userId: null,
        applicantIdentity: { source: "portal_submitter", verified: true, pending: "IDENTITY_LINK_PENDING" },
      };
    }
    const id = String(submitterUserId).trim();
    let own = null;
    if (tenantId) {
      const oid = mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
      own = await User.findOne({
        tenantId,
        userType: "PORTAL",
        isActive: true,
        $or: [{ userId: id }, ...(oid ? [{ _id: oid }] : [])],
      })
        .select("userId")
        .lean();
    }
    return {
      userId: own?.userId ? String(own.userId) : id,
      applicantIdentity: { source: "portal_submitter", verified: true, pending: null },
    };
  }
  const userId = await resolvePortalUserServiceId({ tenantId, profileUserId, linkedUserId, userEmail });
  return { userId, applicantIdentity: { source: "crm_created", verified: false, pending: null } };
}

module.exports = { resolvePortalUserServiceId, isPortalSubmitted, resolveApplicationRecipient };

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

module.exports = { resolvePortalUserServiceId };

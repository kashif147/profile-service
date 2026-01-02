const User = require("../../models/user.model.js");
const Profile = require("../../models/profile.model.js");

/**
 * Handle Portal user created event
 * Creates/updates user in profile-service and links to profile if exists
 */
async function handlePortalUserCreated(payload) {
  const { data } = payload;
  const {
    userId,
    userEmail,
    userFullName,
    userFirstName,
    userLastName,
    userMobilePhone,
    userMemberNumber,
    userMicrosoftId,
    tenantId,
  } = data;

  if (!userId || !tenantId) {
    console.warn(
      "Invalid Portal user created event: missing userId or tenantId",
      payload
    );
    return;
  }

  try {
    // 1. Create/update user in profile-service
    await User.findOneAndUpdate(
      { tenantId, userId: userId },
      {
        $set: {
          userId: userId,
          userEmail: userEmail || null,
          userFullName: userFullName || null,
          userFirstName: userFirstName || null,
          userLastName: userLastName || null,
          userMobilePhone: userMobilePhone || null,
          userMemberNumber: userMemberNumber || null,
          userMicrosoftId: userMicrosoftId || null,
          tenantId,
          userType: "PORTAL",
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    console.log(
      `✅ Portal user created/updated in profile-service: ${userId} (${userEmail})`
    );

    // 2. Find profile by email or member number if available
    if (userEmail || userMemberNumber) {
      const normalizedEmail = userEmail ? userEmail.toLowerCase() : null;
      const profile = await Profile.findOne({
        tenantId,
        $or: [
          ...(normalizedEmail ? [{ normalizedEmail }] : []),
          ...(userMemberNumber ? [{ membershipNumber: userMemberNumber }] : []),
        ],
      });

      if (profile) {
        console.log(
          `📋 Found profile for Portal user ${userEmail || userMemberNumber}, linking userId...`
        );

        // 3. Update profile with userId if not already set
        if (!profile.userId || String(profile.userId) !== String(userId)) {
          await Profile.updateOne(
            { _id: profile._id },
            { $set: { userId: userId } }
          );
          console.log(
            `✅ Linked Portal user ${userId} to profile: ${profile._id}`
          );
        } else {
          console.log(
            `ℹ️ Profile already linked to Portal user ${userId}`
          );
        }
      } else {
        console.log(
          `ℹ️ No profile found for Portal user ${userEmail || userMemberNumber}, userId will be set when profile is created`
        );
      }
    }
  } catch (error) {
    console.error(
      "❌ Error handling Portal user created event:",
      error.message,
      { userId, tenantId }
    );
    throw error;
  }
}

/**
 * Handle Portal user updated event
 * Updates user in profile-service and profile link if needed
 */
async function handlePortalUserUpdated(payload) {
  const { data } = payload;
  const {
    userId,
    userEmail,
    userFullName,
    userFirstName,
    userLastName,
    userMobilePhone,
    userMemberNumber,
    tenantId,
  } = data;

  if (!userId || !tenantId) {
    console.warn(
      "Invalid Portal user updated event: missing userId or tenantId",
      payload
    );
    return;
  }

  try {
    // 1. Update user in profile-service
    await User.findOneAndUpdate(
      { tenantId, userId: userId },
      {
        $set: {
          userEmail: userEmail || null,
          userFullName: userFullName || null,
          userFirstName: userFirstName || null,
          userLastName: userLastName || null,
          userMobilePhone: userMobilePhone || null,
          userMemberNumber: userMemberNumber || null,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    console.log(
      `✅ Portal user updated in profile-service: ${userId} (${userEmail})`
    );

    // 2. Update profile if email or member number changed
    if (userEmail || userMemberNumber) {
      const normalizedEmail = userEmail ? userEmail.toLowerCase() : null;
      const profile = await Profile.findOne({
        tenantId,
        userId: userId,
      });

      if (profile) {
        const updateFields = {};
        if (normalizedEmail && profile.normalizedEmail !== normalizedEmail) {
          updateFields.normalizedEmail = normalizedEmail;
        }
        if (userMemberNumber && profile.membershipNumber !== userMemberNumber) {
          updateFields.membershipNumber = userMemberNumber;
        }

        if (Object.keys(updateFields).length > 0) {
          await Profile.updateOne(
            { _id: profile._id },
            { $set: updateFields }
          );
          console.log(
            `✅ Updated profile fields for Portal user ${userId}:`,
            Object.keys(updateFields)
          );
        }
      } else {
        // Try to find profile by email or member number and link it
        const profileByEmailOrMember = await Profile.findOne({
          tenantId,
          $or: [
            ...(normalizedEmail ? [{ normalizedEmail }] : []),
            ...(userMemberNumber ? [{ membershipNumber: userMemberNumber }] : []),
          ],
        });

        if (profileByEmailOrMember) {
          await Profile.updateOne(
            { _id: profileByEmailOrMember._id },
            { $set: { userId: userId } }
          );
          console.log(
            `✅ Linked Portal user ${userId} to existing profile: ${profileByEmailOrMember._id}`
          );
        }
      }
    }
  } catch (error) {
    console.error(
      "❌ Error handling Portal user updated event:",
      error.message,
      { userId, tenantId }
    );
    throw error;
  }
}

module.exports = {
  handlePortalUserCreated,
  handlePortalUserUpdated,
};


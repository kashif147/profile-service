const User = require("../../models/user.model.js");
const {
  syncedUserObjectId,
  setOnInsertSyncedUserId,
} = require("../../helpers/syncedUserDocumentId.js");
const Profile = require("../../models/profile.model.js");
const PersonalDetails = require("../../models/personal.details.model.js");
const ProfessionalDetails = require("../../models/professional.details.model.js");
const SubscriptionDetails = require("../../models/subscription.model.js");
const {
  publishProfileAfterUpdateOne,
} = require("../../services/profile.audit.publisher.js");

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
    const setOnInsert = setOnInsertSyncedUserId(userId);
    // 1. Create/update user in profile-service
    const syncedUser = await User.findOneAndUpdate(
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
        ...(setOnInsert ? { $setOnInsert: setOnInsert } : {}),
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );
    const localUserId = syncedUser._id;

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
        if (!profile.userId || String(profile.userId) !== String(localUserId)) {
          const beforeLean = profile.toObject({ depopulate: true });
          await Profile.updateOne(
            { _id: profile._id },
            { $set: { userId: localUserId } }
          );
          await publishProfileAfterUpdateOne({
            tenantId,
            profileId: profile._id,
            beforeLean,
            actorId: null,
            source: "user.portal.created",
          });
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

      // 4. Find PersonalDetails by email and update userId
      if (userEmail) {
        const normalizedEmail = userEmail.toLowerCase();
        const personalDetails = await PersonalDetails.findOne({
          $or: [
            { "contactInfo.personalEmail": new RegExp(`^${normalizedEmail}$`, "i") },
            { "contactInfo.workEmail": new RegExp(`^${normalizedEmail}$`, "i") },
          ],
          "meta.deleted": { $ne: true },
        });

        if (personalDetails) {
          console.log(
            `📋 Found PersonalDetails for Portal user ${userEmail}, linking userId...`
          );

          // Update PersonalDetails with userId if not already set
          if (!personalDetails.userId || String(personalDetails.userId) !== String(localUserId)) {
            await PersonalDetails.updateOne(
              { _id: personalDetails._id },
              { $set: { userId: localUserId } }
            );
            console.log(
              `✅ Linked Portal user ${userId} to PersonalDetails: ${personalDetails._id}`
            );
          } else {
            console.log(
              `ℹ️ PersonalDetails already linked to Portal user ${userId}`
            );
          }

          // 5. Get applicationId from PersonalDetails and update ProfessionalDetails
          // Always check and update ProfessionalDetails and SubscriptionDetails, even if PersonalDetails was already linked
          if (personalDetails.applicationId) {
            const professionalDetails = await ProfessionalDetails.findOne({
              applicationId: personalDetails.applicationId,
            });

            if (professionalDetails) {
              if (!professionalDetails.userId || String(professionalDetails.userId) !== String(localUserId)) {
                await ProfessionalDetails.updateOne(
                  { _id: professionalDetails._id },
                  { $set: { userId: localUserId } }
                );
                console.log(
                  `✅ Linked Portal user ${userId} to ProfessionalDetails: ${professionalDetails._id} (via applicationId: ${personalDetails.applicationId})`
                );
              } else {
                console.log(
                  `ℹ️ ProfessionalDetails already linked to Portal user ${userId}`
                );
              }
            }

            // 6. Update SubscriptionDetails by applicationId
            const subscriptionDetails = await SubscriptionDetails.findOne({
              applicationId: personalDetails.applicationId,
            });

            if (subscriptionDetails) {
              if (!subscriptionDetails.userId || String(subscriptionDetails.userId) !== String(localUserId)) {
                await SubscriptionDetails.updateOne(
                  { _id: subscriptionDetails._id },
                  { $set: { userId: localUserId } }
                );
                console.log(
                  `✅ Linked Portal user ${userId} to SubscriptionDetails: ${subscriptionDetails._id} (via applicationId: ${personalDetails.applicationId})`
                );
              } else {
                console.log(
                  `ℹ️ SubscriptionDetails already linked to Portal user ${userId}`
                );
              }
            }
          }
        } else {
          console.log(
            `ℹ️ No PersonalDetails found for Portal user ${userEmail}`
          );
        }
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
    const setOnInsert = setOnInsertSyncedUserId(userId);
    // 1. Update user in profile-service
    const syncedUser = await User.findOneAndUpdate(
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
        ...(setOnInsert ? { $setOnInsert: setOnInsert } : {}),
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );
    const localUserId = syncedUser._id;

    console.log(
      `✅ Portal user updated in profile-service: ${userId} (${userEmail})`
    );

    // 2. Update profile if email or member number changed
    if (userEmail || userMemberNumber) {
      const normalizedEmail = userEmail ? userEmail.toLowerCase() : null;
      const userIdCandidates = [localUserId];
      const legacyUserObjectId = syncedUserObjectId(userId);
      if (legacyUserObjectId) userIdCandidates.push(legacyUserObjectId);

      const profile = await Profile.findOne({
        tenantId,
        userId: { $in: userIdCandidates },
      });

      if (profile) {
        const updateFields = {};
        if (String(profile.userId) !== String(localUserId)) {
          updateFields.userId = localUserId;
        }
        if (normalizedEmail && profile.normalizedEmail !== normalizedEmail) {
          updateFields.normalizedEmail = normalizedEmail;
        }
        if (userMemberNumber && profile.membershipNumber !== userMemberNumber) {
          updateFields.membershipNumber = userMemberNumber;
        }

        if (Object.keys(updateFields).length > 0) {
          const beforeLean = profile.toObject({ depopulate: true });
          await Profile.updateOne(
            { _id: profile._id },
            { $set: updateFields }
          );
          await publishProfileAfterUpdateOne({
            tenantId,
            profileId: profile._id,
            beforeLean,
            actorId: null,
            source: "user.portal.updated",
          });
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
          const beforeLean = profileByEmailOrMember.toObject({
            depopulate: true,
          });
          await Profile.updateOne(
            { _id: profileByEmailOrMember._id },
            { $set: { userId: localUserId } }
          );
          await publishProfileAfterUpdateOne({
            tenantId,
            profileId: profileByEmailOrMember._id,
            beforeLean,
            actorId: null,
            source: "user.portal.updated",
          });
          console.log(
            `✅ Linked Portal user ${userId} to existing profile: ${profileByEmailOrMember._id}`
          );
        }
      }

      // 4. Find PersonalDetails by email and update userId
      if (userEmail) {
        const normalizedEmail = userEmail.toLowerCase();
        const personalDetails = await PersonalDetails.findOne({
          $or: [
            { "contactInfo.personalEmail": new RegExp(`^${normalizedEmail}$`, "i") },
            { "contactInfo.workEmail": new RegExp(`^${normalizedEmail}$`, "i") },
          ],
          "meta.deleted": { $ne: true },
        });

        if (personalDetails) {
          console.log(
            `📋 Found PersonalDetails for Portal user ${userEmail}, linking userId...`
          );

          // Update PersonalDetails with userId if not already set
          if (!personalDetails.userId || String(personalDetails.userId) !== String(localUserId)) {
            await PersonalDetails.updateOne(
              { _id: personalDetails._id },
              { $set: { userId: localUserId } }
            );
            console.log(
              `✅ Linked Portal user ${userId} to PersonalDetails: ${personalDetails._id}`
            );
          } else {
            console.log(
              `ℹ️ PersonalDetails already linked to Portal user ${userId}`
            );
          }

          // 5. Get applicationId from PersonalDetails and update ProfessionalDetails
          // Always check and update ProfessionalDetails and SubscriptionDetails, even if PersonalDetails was already linked
          if (personalDetails.applicationId) {
            const professionalDetails = await ProfessionalDetails.findOne({
              applicationId: personalDetails.applicationId,
            });

            if (professionalDetails) {
              if (!professionalDetails.userId || String(professionalDetails.userId) !== String(localUserId)) {
                await ProfessionalDetails.updateOne(
                  { _id: professionalDetails._id },
                  { $set: { userId: localUserId } }
                );
                console.log(
                  `✅ Linked Portal user ${userId} to ProfessionalDetails: ${professionalDetails._id} (via applicationId: ${personalDetails.applicationId})`
                );
              } else {
                console.log(
                  `ℹ️ ProfessionalDetails already linked to Portal user ${userId}`
                );
              }
            }

            // 6. Update SubscriptionDetails by applicationId
            const subscriptionDetails = await SubscriptionDetails.findOne({
              applicationId: personalDetails.applicationId,
            });

            if (subscriptionDetails) {
              if (!subscriptionDetails.userId || String(subscriptionDetails.userId) !== String(localUserId)) {
                await SubscriptionDetails.updateOne(
                  { _id: subscriptionDetails._id },
                  { $set: { userId: localUserId } }
                );
                console.log(
                  `✅ Linked Portal user ${userId} to SubscriptionDetails: ${subscriptionDetails._id} (via applicationId: ${personalDetails.applicationId})`
                );
              } else {
                console.log(
                  `ℹ️ SubscriptionDetails already linked to Portal user ${userId}`
                );
              }
            }
          }
        } else {
          console.log(
            `ℹ️ No PersonalDetails found for Portal user ${userEmail}`
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

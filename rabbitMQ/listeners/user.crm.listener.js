const User = require("../../models/user.model.js");
const Profile = require("../../models/profile.model.js");
const { ApplicationApprovalEventPublisher } = require("../index.js");
const crypto = require("crypto");

/**
 * Handle CRM user created event
 * Also creates/updates subscription for the CRM user's profile if it exists
 */
async function handleCrmUserCreated(payload) {
  const { data } = payload;
  const { userId, userEmail, userFullName, tenantId } = data;

  if (!userId || !tenantId) {
    console.warn(
      "Invalid CRM user created event: missing userId or tenantId",
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
          tenantId,
          userType: "CRM",
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    console.log(
      `✅ CRM user created/updated in profile-service: ${userId} (${userEmail})`
    );

    // 2. Find profile by email if available
    if (userEmail) {
      const normalizedEmail = userEmail.toLowerCase();
      const profile = await Profile.findOne({
        tenantId,
        normalizedEmail
      });

      if (profile) {
        console.log(
          `📋 Found profile for CRM user ${userEmail}, creating subscription...`
        );

        // 3. Publish subscription upsert event for this profile
        await ApplicationApprovalEventPublisher.publishSubscriptionUpsertRequested({
          tenantId,
          profileId: String(profile._id),
          applicationId: null, // No application for CRM user direct subscription
          membershipCategory: null, // Will use default or existing
          dateJoined: profile.firstJoinedDate || new Date(),
          paymentType: null,
          payrollNo: null,
          paymentFrequency: null,
          correlationId: crypto.randomUUID(),
        });

        console.log(
          `✅ Subscription upsert requested for CRM user profile: ${profile._id}`
        );
      } else {
        console.log(
          `ℹ️ No profile found for CRM user ${userEmail}, skipping subscription creation`
        );
      }
    }
  } catch (error) {
    console.error(
      "❌ Error handling CRM user created event:",
      error.message,
      { userId, tenantId }
    );
    throw error;
  }
}

/**
 * Handle CRM user updated event
 * Also updates subscription for the CRM user's profile if it exists
 */
async function handleCrmUserUpdated(payload) {
  const { data } = payload;
  const { userId, userEmail, userFullName, tenantId } = data;

  if (!userId || !tenantId) {
    console.warn(
      "Invalid CRM user updated event: missing userId or tenantId",
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
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    console.log(
      `✅ CRM user updated in profile-service: ${userId} (${userEmail})`
    );

    // 2. Find profile by email if available
    if (userEmail) {
      const normalizedEmail = userEmail.toLowerCase();
      const profile = await Profile.findOne({
        tenantId,
        normalizedEmail
      });

      if (profile) {
        console.log(
          `📋 Found profile for updated CRM user ${userEmail}, updating subscription...`
        );

        // 3. Publish subscription upsert event for this profile
        await ApplicationApprovalEventPublisher.publishSubscriptionUpsertRequested({
          tenantId,
          profileId: String(profile._id),
          applicationId: null,
          membershipCategory: null,
          dateJoined: profile.firstJoinedDate || new Date(),
          paymentType: null,
          payrollNo: null,
          paymentFrequency: null,
          correlationId: crypto.randomUUID(),
        });

        console.log(
          `✅ Subscription upsert requested for updated CRM user profile: ${profile._id}`
        );
      } else {
        console.log(
          `ℹ️ No profile found for updated CRM user ${userEmail}, skipping subscription update`
        );
      }
    }
  } catch (error) {
    console.error(
      "❌ Error handling CRM user updated event:",
      error.message,
      { userId, tenantId }
    );
    throw error;
  }
}

module.exports = {
  handleCrmUserCreated,
  handleCrmUserUpdated,
};


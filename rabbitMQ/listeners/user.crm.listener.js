const User = require("../../models/user.model.js");
const Profile = require("../../models/profile.model.js");
const PersonalDetails = require("../../models/personal.details.model.js");
const ProfessionalDetails = require("../../models/professional.details.model.js");
const SubscriptionDetails = require("../../models/subscription.model.js");
const ApplicationApprovalEventPublisher = require("../publishers/application.approval.publisher.js");
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
          memberId: profile?.membershipNumber ?? null,
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

      // 4. Find PersonalDetails by email and update userId
      const personalDetails = await PersonalDetails.findOne({
        $or: [
          { "contactInfo.personalEmail": new RegExp(`^${normalizedEmail}$`, "i") },
          { "contactInfo.workEmail": new RegExp(`^${normalizedEmail}$`, "i") },
        ],
        "meta.deleted": { $ne: true },
      });

      if (personalDetails) {
        console.log(
          `📋 Found PersonalDetails for CRM user ${userEmail}, linking userId...`
        );

        // Update PersonalDetails with userId if not already set
        if (!personalDetails.userId || String(personalDetails.userId) !== String(userId)) {
          await PersonalDetails.updateOne(
            { _id: personalDetails._id },
            { $set: { userId: userId } }
          );
          console.log(
            `✅ Linked CRM user ${userId} to PersonalDetails: ${personalDetails._id}`
          );
        } else {
          console.log(
            `ℹ️ PersonalDetails already linked to CRM user ${userId}`
          );
        }

        // 5. Get applicationId from PersonalDetails and update ProfessionalDetails
        // Always check and update ProfessionalDetails and SubscriptionDetails, even if PersonalDetails was already linked
        if (personalDetails.applicationId) {
          const professionalDetails = await ProfessionalDetails.findOne({
            applicationId: personalDetails.applicationId,
          });

          if (professionalDetails) {
            if (!professionalDetails.userId || String(professionalDetails.userId) !== String(userId)) {
              await ProfessionalDetails.updateOne(
                { _id: professionalDetails._id },
                { $set: { userId: userId } }
              );
              console.log(
                `✅ Linked CRM user ${userId} to ProfessionalDetails: ${professionalDetails._id} (via applicationId: ${personalDetails.applicationId})`
              );
            } else {
              console.log(
                `ℹ️ ProfessionalDetails already linked to CRM user ${userId}`
              );
            }
          }

          // 6. Update SubscriptionDetails by applicationId
          const subscriptionDetails = await SubscriptionDetails.findOne({
            applicationId: personalDetails.applicationId,
          });

          if (subscriptionDetails) {
            if (!subscriptionDetails.userId || String(subscriptionDetails.userId) !== String(userId)) {
              await SubscriptionDetails.updateOne(
                { _id: subscriptionDetails._id },
                { $set: { userId: userId } }
              );
              console.log(
                `✅ Linked CRM user ${userId} to SubscriptionDetails: ${subscriptionDetails._id} (via applicationId: ${personalDetails.applicationId})`
              );
            } else {
              console.log(
                `ℹ️ SubscriptionDetails already linked to CRM user ${userId}`
              );
            }
          }
        }
      } else {
        console.log(
          `ℹ️ No PersonalDetails found for CRM user ${userEmail}`
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
          memberId: profile?.membershipNumber ?? null,
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

      // 4. Find PersonalDetails by email and update userId
      const personalDetails = await PersonalDetails.findOne({
        $or: [
          { "contactInfo.personalEmail": new RegExp(`^${normalizedEmail}$`, "i") },
          { "contactInfo.workEmail": new RegExp(`^${normalizedEmail}$`, "i") },
        ],
        "meta.deleted": { $ne: true },
      });

      if (personalDetails) {
        console.log(
          `📋 Found PersonalDetails for updated CRM user ${userEmail}, linking userId...`
        );

        // Update PersonalDetails with userId if not already set
        if (!personalDetails.userId || String(personalDetails.userId) !== String(userId)) {
          await PersonalDetails.updateOne(
            { _id: personalDetails._id },
            { $set: { userId: userId } }
          );
          console.log(
            `✅ Linked CRM user ${userId} to PersonalDetails: ${personalDetails._id}`
          );
        } else {
          console.log(
            `ℹ️ PersonalDetails already linked to CRM user ${userId}`
          );
        }

        // 5. Get applicationId from PersonalDetails and update ProfessionalDetails
        // Always check and update ProfessionalDetails and SubscriptionDetails, even if PersonalDetails was already linked
        if (personalDetails.applicationId) {
          const professionalDetails = await ProfessionalDetails.findOne({
            applicationId: personalDetails.applicationId,
          });

          if (professionalDetails) {
            if (!professionalDetails.userId || String(professionalDetails.userId) !== String(userId)) {
              await ProfessionalDetails.updateOne(
                { _id: professionalDetails._id },
                { $set: { userId: userId } }
              );
              console.log(
                `✅ Linked CRM user ${userId} to ProfessionalDetails: ${professionalDetails._id} (via applicationId: ${personalDetails.applicationId})`
              );
            } else {
              console.log(
                `ℹ️ ProfessionalDetails already linked to CRM user ${userId}`
              );
            }
          }

          // 6. Update SubscriptionDetails by applicationId
          const subscriptionDetails = await SubscriptionDetails.findOne({
            applicationId: personalDetails.applicationId,
          });

          if (subscriptionDetails) {
            if (!subscriptionDetails.userId || String(subscriptionDetails.userId) !== String(userId)) {
              await SubscriptionDetails.updateOne(
                { _id: subscriptionDetails._id },
                { $set: { userId: userId } }
              );
              console.log(
                `✅ Linked CRM user ${userId} to SubscriptionDetails: ${subscriptionDetails._id} (via applicationId: ${personalDetails.applicationId})`
              );
            } else {
              console.log(
                `ℹ️ SubscriptionDetails already linked to CRM user ${userId}`
              );
            }
          }
        }
      } else {
        console.log(
          `ℹ️ No PersonalDetails found for updated CRM user ${userEmail}`
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


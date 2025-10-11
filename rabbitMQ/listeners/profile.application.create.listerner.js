const PersonalDetails = require("../../models/personal.details.model.js");
const ProfessionalDetails = require("../../models/professional.details.model.js");
const SubscriptionDetails = require("../../models/subscription.model.js");

class ProfileApplicationCreateListener {
  constructor() {
    // This listener handles profile.application.create events from portal service
  }

  async handleProfileApplicationCreate(data) {
    try {
      console.log(
        "📥 [PROFILE_CREATE_LISTENER] Received profile application create:",
        {
          applicationId: data.applicationId,
          tenantId: data.tenantId,
          status: data.status,
          timestamp: new Date().toISOString(),
        }
      );

      const {
        applicationId,
        tenantId,
        status,
        personalDetails,
        professionalDetails,
        subscriptionDetails,
      } = data;

      // 1. Create Personal Details
      console.log("📝 [PROFILE_CREATE_LISTENER] Creating personal details...");
      const newPersonalDetails = await PersonalDetails.create({
        ApplicationId: applicationId,
        userId: personalDetails.userId,
        personalInfo: personalDetails.personalInfo,
        contactInfo: personalDetails.contactInfo,
        applicationStatus: personalDetails.applicationStatus || status,
        approvalDetails: personalDetails.approvalDetails,
        meta: personalDetails.meta,
      });

      console.log("✅ [PROFILE_CREATE_LISTENER] Personal details created:", {
        id: newPersonalDetails._id,
        applicationId: newPersonalDetails.ApplicationId,
      });

      // 2. Create Professional Details
      if (professionalDetails) {
        console.log(
          "📝 [PROFILE_CREATE_LISTENER] Creating professional details..."
        );
        const newProfessionalDetails = await ProfessionalDetails.create({
          ApplicationId: applicationId,
          userId: professionalDetails.userId,
          professionalDetails: professionalDetails.professionalDetails,
          meta: professionalDetails.meta,
        });

        console.log(
          "✅ [PROFILE_CREATE_LISTENER] Professional details created:",
          {
            id: newProfessionalDetails._id,
            applicationId: newProfessionalDetails.ApplicationId,
          }
        );
      } else {
        console.log(
          "⚠️ [PROFILE_CREATE_LISTENER] No professional details provided"
        );
      }

      // 3. Create Subscription Details
      if (subscriptionDetails) {
        console.log(
          "📝 [PROFILE_CREATE_LISTENER] Creating subscription details..."
        );
        const newSubscriptionDetails = await SubscriptionDetails.create({
          ApplicationId: applicationId,
          userId: subscriptionDetails.userId,
          membershipNumber: subscriptionDetails.membershipNumber,
          subscriptionDetails: subscriptionDetails.subscriptionDetails,
          paymentDetails: subscriptionDetails.paymentDetails,
          meta: subscriptionDetails.meta,
        });

        console.log(
          "✅ [PROFILE_CREATE_LISTENER] Subscription details created:",
          {
            id: newSubscriptionDetails._id,
            applicationId: newSubscriptionDetails.ApplicationId,
            membershipNumber: newSubscriptionDetails.membershipNumber,
          }
        );
      } else {
        console.log(
          "⚠️ [PROFILE_CREATE_LISTENER] No subscription details provided"
        );
      }

      console.log(
        "✅ [PROFILE_CREATE_LISTENER] Profile application created successfully:",
        {
          applicationId,
          tenantId,
        }
      );
    } catch (error) {
      console.error(
        "❌ [PROFILE_CREATE_LISTENER] Error creating profile application:",
        {
          error: error.message,
          applicationId: data?.applicationId,
        }
      );
      throw error;
    }
  }
}

module.exports = new ProfileApplicationCreateListener();

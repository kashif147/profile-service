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

      // 1. Create/Update Personal Details (Idempotent)
      console.log(
        "📝 [PROFILE_CREATE_LISTENER] Creating/updating personal details..."
      );
      const newPersonalDetails = await PersonalDetails.findOneAndUpdate(
        { applicationId: applicationId },
        {
          applicationId: applicationId,
          userId: personalDetails.userId,
          personalInfo: personalDetails.personalInfo,
          contactInfo: personalDetails.contactInfo,
          applicationStatus: personalDetails.applicationStatus || status,
          approvalDetails: personalDetails.approvalDetails,
          meta: personalDetails.meta,
        },
        { upsert: true, new: true, runValidators: true }
      );

      console.log(
        "✅ [PROFILE_CREATE_LISTENER] Personal details created/updated:",
        {
          id: newPersonalDetails._id,
          applicationId: newPersonalDetails.applicationId,
        }
      );

      // 2. Create/Update Professional Details (Idempotent)
      if (professionalDetails) {
        console.log(
          "📝 [PROFILE_CREATE_LISTENER] Creating/updating professional details..."
        );
        const newProfessionalDetails =
          await ProfessionalDetails.findOneAndUpdate(
            { applicationId: applicationId },
            {
              applicationId: applicationId,
              userId: professionalDetails.userId,
              professionalDetails: professionalDetails.professionalDetails,
              meta: professionalDetails.meta,
            },
            { upsert: true, new: true, runValidators: true }
          );

        console.log(
          "✅ [PROFILE_CREATE_LISTENER] Professional details created/updated:",
          {
            id: newProfessionalDetails._id,
            applicationId: newProfessionalDetails.applicationId,
          }
        );
      } else {
        console.log(
          "⚠️ [PROFILE_CREATE_LISTENER] No professional details provided"
        );
      }

      // 3. Create/Update Subscription Details (Idempotent)
      if (subscriptionDetails) {
        console.log(
          "📝 [PROFILE_CREATE_LISTENER] Creating/updating subscription details..."
        );

        // Build update object - only include membershipNumber if application is approved
        const updateData = {
          applicationId: applicationId,
          userId: subscriptionDetails.userId,
          subscriptionDetails: subscriptionDetails.subscriptionDetails,
          paymentDetails: subscriptionDetails.paymentDetails,
          meta: subscriptionDetails.meta,
        };

        // Only copy membershipNumber if application status is approved
        if (status === "approved" && subscriptionDetails.membershipNumber) {
          updateData.membershipNumber = subscriptionDetails.membershipNumber;
        }

        const newSubscriptionDetails =
          await SubscriptionDetails.findOneAndUpdate(
            { applicationId: applicationId },
            updateData,
            { upsert: true, new: true, runValidators: true }
          );

        console.log(
          "✅ [PROFILE_CREATE_LISTENER] Subscription details created/updated:",
          {
            id: newSubscriptionDetails._id,
            applicationId: newSubscriptionDetails.applicationId,
            membershipNumber: newSubscriptionDetails.membershipNumber,
            status: status,
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

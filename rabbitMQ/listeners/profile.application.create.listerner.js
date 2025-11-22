const PersonalDetails = require("../../models/personal.details.model.js");
const ProfessionalDetails = require("../../models/professional.details.model.js");
const SubscriptionDetails = require("../../models/subscription.model.js");
const {
  detectDuplicates,
} = require("../../services/duplicate.detection.service.js");

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

      console.log("🔍 [PROFILE_CREATE_LISTENER] Event data structure:", {
        applicationId,
        hasPersonalDetails: !!personalDetails,
        hasProfessionalDetails: !!professionalDetails,
        hasSubscriptionDetails: !!subscriptionDetails,
        subscriptionDetailsType: subscriptionDetails
          ? typeof subscriptionDetails
          : "null",
        subscriptionDetailsKeys: subscriptionDetails
          ? Object.keys(subscriptionDetails)
          : [],
        subscriptionDetailsApplicationId: subscriptionDetails?.applicationId,
        subscriptionDetailsUserId: subscriptionDetails?.userId,
        hasSubscriptionDetailsField: !!subscriptionDetails?.subscriptionDetails,
        hasPaymentDetails: !!subscriptionDetails?.paymentDetails,
      });

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
      // Always create/update subscription details, even if not provided in event
      // Use data from event if available, otherwise create with defaults
      console.log(
        "📝 [PROFILE_CREATE_LISTENER] Creating/updating subscription details..."
      );

      // Build update object - use subscriptionDetails from event if available, otherwise use defaults
      // Note: paymentDetails is not stored in profile-service model (commented out in schema)
      let subscriptionDetailsData =
        subscriptionDetails?.subscriptionDetails || {};

      // Enforce payment frequency rule: Credit Card = Annually, Others = Monthly
      const {
        enforcePaymentFrequencyRule,
      } = require("../../helpers/payment.frequency.helper.js");
      subscriptionDetailsData = enforcePaymentFrequencyRule(
        subscriptionDetailsData
      );

      // Build updateData, handling meta structure differences
      // Portal-service has deleted/isActive in meta, profile-service has them at root
      const portalMeta = subscriptionDetails?.meta || {};
      const updateData = {
        applicationId: applicationId,
        userId: subscriptionDetails?.userId || newPersonalDetails.userId,
        subscriptionDetails: subscriptionDetailsData,
        meta: {
          createdBy: portalMeta.createdBy || newPersonalDetails.userId,
          updatedBy: portalMeta.updatedBy || null,
          userType: portalMeta.userType || "PORTAL",
        },
        // Handle deleted/isActive - portal has them in meta, profile has at root
        deleted: portalMeta.deleted !== undefined ? portalMeta.deleted : false,
        isActive: portalMeta.isActive !== undefined ? portalMeta.isActive : true,
      };

      // Only copy membershipNumber if application status is approved
      if (status === "approved" && subscriptionDetails?.membershipNumber) {
        updateData.membershipNumber = subscriptionDetails.membershipNumber;
      }

      try {
        const newSubscriptionDetails = await SubscriptionDetails.findOneAndUpdate(
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
            hadSubscriptionDetailsInEvent: !!subscriptionDetails,
            subscriptionDetailsKeys: newSubscriptionDetails.subscriptionDetails
              ? Object.keys(newSubscriptionDetails.subscriptionDetails)
              : [],
            hasPaymentType: !!newSubscriptionDetails.subscriptionDetails?.paymentType,
            hasPaymentFrequency: !!newSubscriptionDetails.subscriptionDetails?.paymentFrequency,
          }
        );
      } catch (saveError) {
        console.error(
          "❌ [PROFILE_CREATE_LISTENER] Failed to save subscription details:",
          {
            error: saveError.message,
            errorName: saveError.name,
            applicationId,
            updateDataKeys: Object.keys(updateData),
            subscriptionDetailsKeys: updateData.subscriptionDetails
              ? Object.keys(updateData.subscriptionDetails)
              : [],
            validationErrors: saveError.errors
              ? Object.keys(saveError.errors)
              : [],
          }
        );
        throw saveError;
      }

      console.log(
        "✅ [PROFILE_CREATE_LISTENER] Profile application created successfully:",
        {
          applicationId,
          tenantId,
        }
      );

      // 4. Run duplicate detection in background (non-blocking)
      // Use setImmediate to run after current event loop, doesn't block response
      if (tenantId) {
        setImmediate(async () => {
          try {
            await detectDuplicates(applicationId, tenantId);
          } catch (error) {
            console.error(
              "❌ [PROFILE_CREATE_LISTENER] Background duplicate detection failed:",
              {
                error: error.message,
                applicationId,
              }
            );
            // Don't throw - duplicate detection failure shouldn't affect application creation
          }
        });
        console.log(
          "🔍 [PROFILE_CREATE_LISTENER] Duplicate detection queued for background processing"
        );
      } else {
        console.warn(
          "⚠️ [PROFILE_CREATE_LISTENER] tenantId missing, skipping duplicate detection"
        );
      }
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

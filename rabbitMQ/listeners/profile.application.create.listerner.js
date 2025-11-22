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
      console.log(
        "🔍 [PROFILE_CREATE_LISTENER] Processing subscriptionDetails from event:",
        {
          hasSubscriptionDetails: !!subscriptionDetails,
          subscriptionDetailsType: subscriptionDetails
            ? typeof subscriptionDetails
            : "null",
          subscriptionDetailsFull: subscriptionDetails
            ? JSON.stringify(subscriptionDetails, null, 2)
            : "null",
          hasNestedSubscriptionDetails: !!subscriptionDetails?.subscriptionDetails,
          nestedSubscriptionDetailsType: subscriptionDetails?.subscriptionDetails
            ? typeof subscriptionDetails.subscriptionDetails
            : "null",
          nestedSubscriptionDetailsKeys: subscriptionDetails?.subscriptionDetails
            ? Object.keys(subscriptionDetails.subscriptionDetails)
            : [],
        }
      );

      let subscriptionDetailsData =
        subscriptionDetails?.subscriptionDetails || {};

      // Check if we have existing subscription details in the database
      const existingSubscriptionDetails = await SubscriptionDetails.findOne({
        applicationId: applicationId,
      });

      // If subscriptionDetailsData is empty but we have existing data, merge them
      if (
        (!subscriptionDetailsData ||
          Object.keys(subscriptionDetailsData).length === 0) &&
        existingSubscriptionDetails?.subscriptionDetails
      ) {
        console.warn(
          "⚠️ [PROFILE_CREATE_LISTENER] subscriptionDetails.subscriptionDetails is empty in event, but found existing data in database - preserving existing data"
        );
        subscriptionDetailsData = existingSubscriptionDetails.subscriptionDetails;
      } else if (
        !subscriptionDetailsData ||
        Object.keys(subscriptionDetailsData).length === 0
      ) {
        console.warn(
          "⚠️ [PROFILE_CREATE_LISTENER] subscriptionDetails.subscriptionDetails is empty, will use schema defaults"
        );
        subscriptionDetailsData = {}; // Will use schema defaults
      }

      // Enforce payment frequency rule: Credit Card = Annually, Others = Monthly
      const {
        enforcePaymentFrequencyRule,
      } = require("../../helpers/payment.frequency.helper.js");
      subscriptionDetailsData = enforcePaymentFrequencyRule(
        subscriptionDetailsData
      );

      console.log(
        "🔍 [PROFILE_CREATE_LISTENER] After payment frequency enforcement:",
        {
          subscriptionDetailsDataKeys: Object.keys(subscriptionDetailsData),
          paymentType: subscriptionDetailsData.paymentType,
          paymentFrequency: subscriptionDetailsData.paymentFrequency,
        }
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

      // Log what we're about to save
      console.log(
        "🔍 [PROFILE_CREATE_LISTENER] About to save subscription details:",
        {
          applicationId,
          updateDataStructure: {
            hasApplicationId: !!updateData.applicationId,
            hasUserId: !!updateData.userId,
            hasSubscriptionDetails: !!updateData.subscriptionDetails,
            subscriptionDetailsType: typeof updateData.subscriptionDetails,
            subscriptionDetailsKeys: updateData.subscriptionDetails
              ? Object.keys(updateData.subscriptionDetails)
              : [],
            subscriptionDetailsPaymentType:
              updateData.subscriptionDetails?.paymentType,
            subscriptionDetailsPaymentFrequency:
              updateData.subscriptionDetails?.paymentFrequency,
            hasMeta: !!updateData.meta,
            metaKeys: updateData.meta ? Object.keys(updateData.meta) : [],
          },
        }
      );

      try {
        // Use $set operator to ensure nested fields are updated correctly
        const updateQuery = {
          $set: {
            applicationId: updateData.applicationId,
            userId: updateData.userId,
            "subscriptionDetails": updateData.subscriptionDetails,
            "meta": updateData.meta,
            deleted: updateData.deleted,
            isActive: updateData.isActive,
          },
        };

        // Only set membershipNumber if provided
        if (updateData.membershipNumber) {
          updateQuery.$set.membershipNumber = updateData.membershipNumber;
        }

        const newSubscriptionDetails = await SubscriptionDetails.findOneAndUpdate(
          { applicationId: applicationId },
          updateQuery,
          { upsert: true, new: true, runValidators: true }
        );

        if (!newSubscriptionDetails) {
          throw new Error(
            `Failed to create/update subscription details for application ${applicationId}`
          );
        }

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
            paymentType: newSubscriptionDetails.subscriptionDetails?.paymentType,
            hasPaymentFrequency:
              !!newSubscriptionDetails.subscriptionDetails?.paymentFrequency,
            paymentFrequency:
              newSubscriptionDetails.subscriptionDetails?.paymentFrequency,
            subscriptionDetailsFull: JSON.stringify(
              newSubscriptionDetails.subscriptionDetails,
              null,
              2
            ),
          }
        );
      } catch (saveError) {
        console.error(
          "❌ [PROFILE_CREATE_LISTENER] Failed to save subscription details:",
          {
            error: saveError.message,
            errorName: saveError.name,
            errorStack: saveError.stack,
            applicationId,
            updateDataKeys: Object.keys(updateData),
            subscriptionDetailsKeys: updateData.subscriptionDetails
              ? Object.keys(updateData.subscriptionDetails)
              : [],
            subscriptionDetailsValue: JSON.stringify(
              updateData.subscriptionDetails,
              null,
              2
            ),
            validationErrors: saveError.errors
              ? Object.keys(saveError.errors).map((key) => ({
                  field: key,
                  message: saveError.errors[key].message,
                  value: saveError.errors[key].value,
                }))
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

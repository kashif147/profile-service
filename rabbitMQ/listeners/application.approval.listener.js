// Application Approval Event Listener
const PersonalDetails = require("../../models/personal.details.model.js");
const ProfessionalDetails = require("../../models/professional.details.model.js");
const SubscriptionDetails = require("../../models/subscription.model.js");
const Profile = require("../../models/profile.model.js");
const { APPLICATION_STATUS } = require("../../constants/enums.js");

// Helper function to handle bypass user ObjectId conversion
function getReviewerIdForDb(reviewerId) {
  if (reviewerId === "bypass-user") {
    return null; // Allow null for bypass users
  }
  return reviewerId;
}

class ApplicationApprovalEventListener {
  constructor() {
    this.serviceName = "profile-service";
  }

  async handleApplicationApproved(data) {
    try {
      console.log(
        "📥 [APPLICATION_APPROVAL_LISTENER] Received application approved event:",
        {
          applicationId: data.applicationId,
          profileId: data.profileId,
          isExistingProfile: data.isExistingProfile,
          tenantId: data.tenantId,
          timestamp: new Date().toISOString(),
        }
      );

      const applicationStatusNorm = (data.applicationStatus || "")
        .toLowerCase()
        .trim();
      if (
        applicationStatusNorm &&
        applicationStatusNorm !== APPLICATION_STATUS.APPROVED
      ) {
        console.log(
          "⏭️ [APPLICATION_APPROVAL_LISTENER] Skipping: payload is not an approval",
          { applicationId: data.applicationId, applicationStatus: data.applicationStatus }
        );
        return;
      }

      const {
        applicationId,
        profileId,
        isExistingProfile,
        effective,
        subscriptionAttributes,
        tenantId,
      } = data;

      if (!effective || typeof effective !== "object") {
        console.warn(
          "⏭️ [APPLICATION_APPROVAL_LISTENER] Skipping: missing effective payload",
          { applicationId }
        );
        return;
      }

      // Update main application models with approved data (including re-approval after rejection)
      if (effective.personalInfo) {
        await PersonalDetails.updateOne(
          { applicationId: applicationId },
          {
            $set: {
              personalInfo: effective.personalInfo,
              contactInfo: effective.contactInfo,
              applicationStatus: APPLICATION_STATUS.APPROVED,
              "meta.isActive": true,
              "approvalDetails.approvedBy": getReviewerIdForDb(data.reviewerId),
              "approvalDetails.approvedAt": new Date(),
            },
          },
          { upsert: true }
        );
        console.log(
          "✅ [APPLICATION_APPROVAL_LISTENER] Personal details updated"
        );
      }

      if (effective.professionalDetails) {
        await ProfessionalDetails.updateOne(
          { applicationId: applicationId },
          { $set: { professionalDetails: effective.professionalDetails } },
          { upsert: true }
        );
        console.log(
          "✅ [APPLICATION_APPROVAL_LISTENER] Professional details updated"
        );
      }

      if (effective.subscriptionDetails) {
        await SubscriptionDetails.updateOne(
          { applicationId: applicationId },
          { $set: { subscriptionDetails: effective.subscriptionDetails } },
          { upsert: true }
        );
        console.log(
          "✅ [APPLICATION_APPROVAL_LISTENER] Subscription details updated"
        );
      }

      await ProfessionalDetails.updateMany(
        { applicationId },
        { $set: { "meta.isActive": true } }
      );
      await SubscriptionDetails.updateMany(
        { applicationId },
        { $set: { "meta.isActive": true } }
      );

      console.log(
        "✅ [APPLICATION_APPROVAL_LISTENER] Application approval processed successfully:",
        {
          applicationId,
          profileId,
          isExistingProfile,
        }
      );
    } catch (error) {
      console.error(
        "❌ [APPLICATION_APPROVAL_LISTENER] Error handling application approved event:",
        {
          error: error.message,
          applicationId: data?.applicationId,
        }
      );
      throw error;
    }
  }

  async handleMemberCreatedRequested(data) {
    try {
      console.log(
        "📥 [APPLICATION_APPROVAL_LISTENER] Received member created requested event:",
        {
          applicationId: data.applicationId,
          profileId: data.profileId,
          isExistingProfile: data.isExistingProfile,
          tenantId: data.tenantId,
          timestamp: new Date().toISOString(),
        }
      );

      // This event is typically consumed by subscription-service
      // But we can log it here for tracking purposes
      console.log(
        "✅ [APPLICATION_APPROVAL_LISTENER] Member created requested event logged:",
        {
          applicationId: data.applicationId,
          profileId: data.profileId,
          isExistingProfile: data.isExistingProfile,
        }
      );
    } catch (error) {
      console.error(
        "❌ [APPLICATION_APPROVAL_LISTENER] Error handling member created requested event:",
        {
          error: error.message,
          applicationId: data?.applicationId,
        }
      );
      throw error;
    }
  }
}

module.exports = new ApplicationApprovalEventListener();

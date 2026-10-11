// Application Approval Event Listener
const PersonalDetails = require("../../models/personal.details.model.js");
const ProfessionalDetails = require("../../models/professional.details.model.js");
const SubscriptionDetails = require("../../models/subscription.model.js");
const Profile = require("../../models/profile.model.js");
const { APPLICATION_STATUS } = require("../../constants/enums.js");
const { resolveEventTenantId } = require("../eventTenant.js");

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

  async handleApplicationApproved(data, { envelopeTenantId } = {}) {
    try {
      console.log(
        "📥 [APPLICATION_APPROVAL_LISTENER] Received application processed event:",
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
        applicationStatusNorm !== APPLICATION_STATUS.PROCESSED
      ) {
        console.log(
          "⏭️ [APPLICATION_APPROVAL_LISTENER] Skipping: payload is not a processed application",
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
      } = data;

      // Tenant: envelope wins over data; a disagreement is refused.
      const tenantResolution = resolveEventTenantId({
        tenantId: envelopeTenantId,
        data,
      });
      if (!tenantResolution.ok) {
        console.warn(
          "⏭️ [APPLICATION_APPROVAL_LISTENER] Skipping: tenant unresolved",
          { applicationId, reason: tenantResolution.reason }
        );
        return;
      }
      const tenantId = tenantResolution.tenantId;

      // Never let the event re-tenant an existing application: if a staging
      // record already exists under a different tenant, refuse the event.
      const existingPersonal = await PersonalDetails.findOne({ applicationId })
        .select("tenantId")
        .lean();
      if (
        existingPersonal &&
        existingPersonal.tenantId &&
        String(existingPersonal.tenantId) !== tenantId
      ) {
        console.warn(
          "⏭️ [APPLICATION_APPROVAL_LISTENER] Refusing: event tenant does not match stored application tenant",
          { applicationId }
        );
        return;
      }

      if (!effective || typeof effective !== "object") {
        console.warn(
          "⏭️ [APPLICATION_APPROVAL_LISTENER] Skipping: missing effective payload",
          { applicationId }
        );
        return;
      }

      // Update main application models with processed data.
      if (effective.personalInfo) {
        await PersonalDetails.updateOne(
          { applicationId: applicationId, tenantId },
          {
            $set: {
              personalInfo: effective.personalInfo,
              contactInfo: effective.contactInfo,
              applicationStatus: APPLICATION_STATUS.PROCESSED,
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
          { applicationId: applicationId, tenantId },
          { $set: { professionalDetails: effective.professionalDetails } },
          { upsert: true }
        );
        console.log(
          "✅ [APPLICATION_APPROVAL_LISTENER] Professional details updated"
        );
      }

      if (effective.subscriptionDetails) {
        await SubscriptionDetails.updateOne(
          { applicationId: applicationId, tenantId },
          { $set: { subscriptionDetails: effective.subscriptionDetails } },
          { upsert: true }
        );
        console.log(
          "✅ [APPLICATION_APPROVAL_LISTENER] Subscription details updated"
        );
      }

      await ProfessionalDetails.updateMany(
        { applicationId, tenantId },
        { $set: { "meta.isActive": true } }
      );
      await SubscriptionDetails.updateMany(
        { applicationId, tenantId },
        { $set: { "meta.isActive": true } }
      );

      console.log(
        "✅ [APPLICATION_APPROVAL_LISTENER] Application processed successfully:",
        {
          applicationId,
          profileId,
          isExistingProfile,
        }
      );
    } catch (error) {
      console.error(
        "❌ [APPLICATION_APPROVAL_LISTENER] Error handling application processed event:",
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

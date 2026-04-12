// Application Approval Event Publisher
const { publisher } = require("@projectShell/rabbitmq-middleware");
const {
  APPLICATION_REVIEW_EVENTS,
  MEMBERSHIP_EVENTS,
} = require("../events/index.js");

class ApplicationApprovalEventPublisher {
  constructor() {
    this.serviceName = "profile-service";
  }

  async publishApplicationApproved({
    applicationId,
    reviewerId,
    profileId,
    applicationStatus,
    isExistingProfile,
    crmUserId,
    memberId,
    userId,
    effective,
    subscriptionAttributes,
    tenantId,
    correlationId,
  }) {
    try {
      console.log(
        "📤 [APPLICATION_APPROVAL_PUBLISHER] Publishing application approved event:",
        {
          applicationId,
          profileId,
          isExistingProfile,
          tenantId,
        }
      );

      // Publish to portal-service for application status update; include tenantId and userId so user-service can upgrade role to Member
      const result = await publisher.publish(
        APPLICATION_REVIEW_EVENTS.APPLICATION_REVIEW_APPROVED,
        {
          applicationId,
          reviewerId,
          profileId,
          applicationStatus,
          isExistingProfile,
          crmUserId: crmUserId || null,
          memberId: memberId || null,
          tenantId: tenantId || null,
          userId: userId || null,
          effective: {
            personalInfo: effective.personalInfo,
            contactInfo: effective.contactInfo,
            professionalDetails: effective.professionalDetails,
            subscriptionDetails: effective.subscriptionDetails,
          },
          subscriptionAttributes,
        },
        {
          tenantId,
          correlationId,
          exchange: "application.events", // Specify the exchange
          routingKey: APPLICATION_REVIEW_EVENTS.APPLICATION_REVIEW_APPROVED,
          metadata: {
            service: "profile-service",
            version: "1.0",
          },
        }
      );

      if (!result.success) {
        throw new Error(
          `Failed to publish application approved event: ${result.error}`
        );
      }

      console.log(
        "✅ [APPLICATION_APPROVAL_PUBLISHER] Application approved event published successfully"
      );
    } catch (error) {
      console.error(
        "❌ [APPLICATION_APPROVAL_PUBLISHER] Error publishing application approved event:",
        {
          error: error.message,
          applicationId,
        }
      );
      throw error;
    }
  }

  async publishApplicationRejected({
    applicationId,
    reviewerId,
    reason,
    notes,
    tenantId,
    applicationStatus = "REJECTED",
    userId,
    correlationId,
  }) {
    try {
      console.log(
        "📤 [APPLICATION_APPROVAL_PUBLISHER] Publishing application rejected event:",
        { applicationId, tenantId }
      );

      const result = await publisher.publish(
        APPLICATION_REVIEW_EVENTS.APPLICATION_REVIEW_REJECTED,
        {
          applicationId,
          reviewerId,
          reason: reason ?? null,
          notes: notes ?? null,
          tenantId: tenantId || null,
          applicationStatus,
          userId: userId || null,
          // Consumers (e.g. portal-service) should set meta.isActive false on application records
          isActive: false,
        },
        {
          tenantId,
          correlationId,
          exchange: "application.events",
          routingKey: APPLICATION_REVIEW_EVENTS.APPLICATION_REVIEW_REJECTED,
          metadata: {
            service: "profile-service",
            version: "1.0",
          },
        }
      );

      if (!result.success) {
        throw new Error(
          `Failed to publish application rejected event: ${result.error}`
        );
      }

      console.log(
        "✅ [APPLICATION_APPROVAL_PUBLISHER] Application rejected event published successfully"
      );
    } catch (error) {
      console.error(
        "❌ [APPLICATION_APPROVAL_PUBLISHER] Error publishing application rejected event:",
        { error: error.message, applicationId }
      );
      throw error;
    }
  }

  async publishMemberCreatedRequested({
    applicationId,
    profileId,
    isExistingProfile,
    crmUserId,
    memberId,
    effective,
    subscriptionAttributes,
    tenantId,
    correlationId,
  }) {
    try {
      console.log(
        "📤 [APPLICATION_APPROVAL_PUBLISHER] Publishing member created requested event:",
        {
          applicationId,
          profileId,
          isExistingProfile,
          tenantId,
        }
      );

      // Publish to subscription-service for membership creation
      const result = await publisher.publish(
        MEMBERSHIP_EVENTS.MEMBER_CREATED_REQUESTED,
        {
          applicationId,
          profileId,
          isExistingProfile,
          crmUserId: crmUserId || null,
          memberId: memberId || null,
          effective,
          subscriptionAttributes,
        },
        {
          tenantId,
          correlationId,
          exchange: "membership.events", // Specify the exchange
          routingKey: MEMBERSHIP_EVENTS.MEMBER_CREATED_REQUESTED,
          metadata: {
            service: "profile-service",
            version: "1.0",
          },
        }
      );

      if (!result.success) {
        throw new Error(
          `Failed to publish member created requested event: ${result.error}`
        );
      }

      console.log(
        "✅ [APPLICATION_APPROVAL_PUBLISHER] Member created requested event published successfully"
      );
    } catch (error) {
      console.error(
        "❌ [APPLICATION_APPROVAL_PUBLISHER] Error publishing member created requested event:",
        {
          error: error.message,
          applicationId,
        }
      );
      throw error;
    }
  }

  async publishSubscriptionUpsertRequested({
    tenantId,
    profileId,
    applicationId,
    memberId, // membership number - for account-service invoice/credit flow
    membershipCategory,
    dateJoined,
    processingDate, // bulk approval only — YYYY-MM-DD; account-service uses max(dateJoined, this) for invoice date
    paymentType,
    payrollNo,
    paymentFrequency,
    userId,
    userEmail,
    reviewerId, // CRM user ID for meta.createdBy and meta.updatedBy
    correlationId,
  }) {
    try {
      console.log(
        "📤 [APPLICATION_APPROVAL_PUBLISHER] Publishing subscription upsert requested:",
        { tenantId, profileId, applicationId }
      );

      // Ensure dateJoined is properly serialized (convert Date object to ISO string if needed)
      const dateJoinedSerialized =
        dateJoined instanceof Date ? dateJoined.toISOString() : dateJoined;

      const processingDateSerialized =
        processingDate != null && processingDate !== ""
          ? processingDate instanceof Date
            ? processingDate.toISOString().split("T")[0]
            : String(processingDate).split("T")[0]
          : undefined;

      const messageBody = {
        profileId,
        applicationId,
        memberId: memberId || null,
        membershipCategory,
        dateJoined: dateJoinedSerialized,
        paymentType,
        payrollNo,
        paymentFrequency,
        userId: userId || null,
        userEmail: userEmail || null,
        reviewerId: reviewerId || null, // Pass reviewerId to subscription service
      };
      if (processingDateSerialized) {
        messageBody.processingDate = processingDateSerialized;
      }

      const result = await publisher.publish(
        MEMBERSHIP_EVENTS.SUBSCRIPTION_UPSERT_REQUESTED,
        messageBody,
        {
          tenantId,
          correlationId,
          exchange: "membership.events",
          routingKey: MEMBERSHIP_EVENTS.SUBSCRIPTION_UPSERT_REQUESTED,
          metadata: { service: "profile-service", version: "1.0" },
        }
      );

      if (!result.success) {
        throw new Error(
          `Failed to publish subscription upsert requested: ${result.error}`
        );
      }

      console.log(
        "✅ [APPLICATION_APPROVAL_PUBLISHER] Subscription upsert requested published successfully"
      );
    } catch (error) {
      console.error(
        "❌ [APPLICATION_APPROVAL_PUBLISHER] Error publishing subscription upsert requested:",
        { error: error.message, applicationId, profileId }
      );
      throw error;
    }
  }
}

module.exports = new ApplicationApprovalEventPublisher();

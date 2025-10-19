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

      // Publish to portal-service for application status update
      const result = await publisher.publish(
        APPLICATION_REVIEW_EVENTS.APPLICATION_REVIEW_APPROVED,
        {
          applicationId,
          reviewerId,
          profileId,
          applicationStatus,
          isExistingProfile,
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

  async publishMemberCreatedRequested({
    applicationId,
    profileId,
    isExistingProfile,
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
}

module.exports = new ApplicationApprovalEventPublisher();

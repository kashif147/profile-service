// Application Approval Event Publisher
const { publisher } = require("@projectShell/rabbitmq-middleware");
const bizLogger = require("../../config/bizLogger.js");
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
    userEmail,
    effective,
    subscriptionAttributes,
    gapLetter,
    tenantId,
    correlationId,
  }) {
    try {
      console.log(
        "📤 [APPLICATION_APPROVAL_PUBLISHER] Publishing application processed event:",
        {
          applicationId,
          profileId,
          isExistingProfile,
          tenantId,
        }
      );

      // Publish to portal-service for application status update; include tenantId and userId so user-service can upgrade role to Member
      const result = await publisher.publish(
        APPLICATION_REVIEW_EVENTS.APPLICATION_REVIEW_PROCESSED,
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
          userEmail: userEmail || null,
          effective: {
            personalInfo: effective.personalInfo,
            contactInfo: effective.contactInfo,
            professionalDetails: effective.professionalDetails,
            subscriptionDetails: effective.subscriptionDetails,
          },
          subscriptionAttributes,
          gapLetter: gapLetter || null,
        },
        {
          tenantId,
          correlationId,
          exchange: "application.events", // Specify the exchange
          routingKey: APPLICATION_REVIEW_EVENTS.APPLICATION_REVIEW_PROCESSED,
          metadata: {
            service: "profile-service",
            version: "1.0",
          },
        }
      );

      if (!result.success) {
        throw new Error(
          `Failed to publish application processed event: ${result.error}`
        );
      }

      console.log(
        "✅ [APPLICATION_APPROVAL_PUBLISHER] Application processed event published successfully"
      );
    } catch (error) {
      console.error(
        "❌ [APPLICATION_APPROVAL_PUBLISHER] Error publishing application processed event:",
        {
          error: error.message,
          applicationId,
        }
      );
      throw error;
    }
  }

  async publishGapLetterRequested({
    applicationId,
    profileId,
    memberId,
    userId,
    userEmail,
    tenantId,
    reviewerId,
    effective,
    gapLetter,
    correlationId,
  }) {
    try {
      if (!gapLetter?.sendGapLetter) return;

      const result = await publisher.publish(
        MEMBERSHIP_EVENTS.GAP_LETTER_REQUESTED,
        {
          applicationId,
          profileId,
          memberId: memberId || null,
          userId: userId || null,
          userEmail: userEmail || null,
          reviewerId: reviewerId || null,
          tenantId: tenantId || null,
          effective: {
            personalInfo: effective?.personalInfo,
            contactInfo: effective?.contactInfo,
            professionalDetails: effective?.professionalDetails,
            subscriptionDetails: effective?.subscriptionDetails,
          },
          gapLetter,
        },
        {
          tenantId,
          correlationId,
          exchange: "membership.events",
          routingKey: MEMBERSHIP_EVENTS.GAP_LETTER_REQUESTED,
          metadata: {
            service: "profile-service",
            version: "1.0",
          },
        }
      );

      if (!result.success) {
        throw new Error(`Failed to publish GAP letter requested: ${result.error}`);
      }

      bizLogger.business("RabbitMQ GAP letter request published", {
        eventType: MEMBERSHIP_EVENTS.GAP_LETTER_REQUESTED,
        eventId: result.eventId,
        correlationId: result.payload?.correlationId || correlationId || null,
        tenantId,
        profileId,
        applicationId,
        membershipId: memberId || null,
        exchange: "membership.events",
        routingKey: MEMBERSHIP_EVENTS.GAP_LETTER_REQUESTED,
        sourceService: "profile-service",
      });
    } catch (error) {
      bizLogger.error("RabbitMQ GAP letter request publish failed", {
        eventType: MEMBERSHIP_EVENTS.GAP_LETTER_REQUESTED,
        error: error.message,
        correlationId,
        tenantId,
        profileId,
        applicationId,
        membershipId: memberId || null,
        exchange: "membership.events",
        routingKey: MEMBERSHIP_EVENTS.GAP_LETTER_REQUESTED,
        sourceService: "profile-service",
      });
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
    processingDate, // bulk approval only — YYYY-MM-DD; forwarded for observability; invoice posts at generation
    submissionDate,
    applicationDate,
    paymentType,
    payrollNo,
    paymentFrequency,
    userId,
    userEmail,
    reviewerId, // CRM user ID for meta.createdBy and meta.updatedBy
    correlationId,
    isCurrent, // optional override for subscription-service upsert (historical / non-current row)
    deactivatePreviousSubscriptionStatus, // e.g. Cancelled when tagging application to existing profile
    membershipMovement,
    previousSubscriptionId,
    previousMembershipStatus,
    movementResolvedAt,
  }) {
    try {
      console.log(
        "📤 [APPLICATION_APPROVAL_PUBLISHER] Publishing subscription upsert requested:",
        { tenantId, profileId, applicationId }
      );

      const serializeDateOnly = (value) => {
        if (value == null || value === "") return value;
        if (typeof value === "string") {
          const trimmed = value.trim();
          if (!trimmed) return null;
          const dmyMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
          if (dmyMatch) {
            const [, day, month, year] = dmyMatch;
            return `${year}-${month}-${day}`;
          }
          if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
          const datePart = trimmed.split("T")[0];
          if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
          const parsed = new Date(trimmed);
          if (!Number.isNaN(parsed.getTime())) {
            const y = parsed.getFullYear();
            const m = String(parsed.getMonth() + 1).padStart(2, "0");
            const d = String(parsed.getDate()).padStart(2, "0");
            return `${y}-${m}-${d}`;
          }
          return trimmed;
        }
        if (value instanceof Date) {
          if (Number.isNaN(value.getTime())) return null;
          const y = value.getFullYear();
          const m = String(value.getMonth() + 1).padStart(2, "0");
          const d = String(value.getDate()).padStart(2, "0");
          return `${y}-${m}-${d}`;
        }
        return String(value);
      };

      // Keep join date as calendar date (YYYY-MM-DD), never ISO datetime.
      const dateJoinedSerialized = serializeDateOnly(dateJoined);

      const processingDateSerialized =
        processingDate != null && processingDate !== ""
          ? processingDate instanceof Date
            ? processingDate.toISOString().split("T")[0]
            : String(processingDate).split("T")[0]
          : undefined;

      const submissionDateSerialized = serializeDateOnly(submissionDate);
      const applicationDateSerialized = serializeDateOnly(applicationDate);

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
      if (submissionDateSerialized != null && submissionDateSerialized !== "") {
        messageBody.submissionDate = submissionDateSerialized;
      }
      if (
        applicationDateSerialized != null &&
        applicationDateSerialized !== ""
      ) {
        messageBody.applicationDate = applicationDateSerialized;
      }
      if (isCurrent !== undefined) {
        messageBody.isCurrent = isCurrent;
      }
      if (deactivatePreviousSubscriptionStatus) {
        messageBody.deactivatePreviousSubscriptionStatus =
          deactivatePreviousSubscriptionStatus;
      }
      if (membershipMovement) {
        messageBody.membershipMovement = membershipMovement;
      }
      if (previousSubscriptionId) {
        messageBody.previousSubscriptionId = String(previousSubscriptionId);
      }
      if (previousMembershipStatus) {
        messageBody.previousMembershipStatus = previousMembershipStatus;
      }
      if (movementResolvedAt) {
        messageBody.movementResolvedAt =
          movementResolvedAt instanceof Date
            ? movementResolvedAt.toISOString()
            : String(movementResolvedAt);
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
        bizLogger.error("RabbitMQ subscription upsert publish failed", {
          eventType: MEMBERSHIP_EVENTS.SUBSCRIPTION_UPSERT_REQUESTED,
          error: result.error,
          correlationId,
          tenantId,
          profileId,
          applicationId,
          membershipId: memberId || null,
          exchange: "membership.events",
          routingKey: MEMBERSHIP_EVENTS.SUBSCRIPTION_UPSERT_REQUESTED,
          sourceService: "profile-service",
        });
        throw new Error(
          `Failed to publish subscription upsert requested: ${result.error}`
        );
      }

      bizLogger.business("RabbitMQ subscription upsert published", {
        eventType: MEMBERSHIP_EVENTS.SUBSCRIPTION_UPSERT_REQUESTED,
        eventId: result.eventId,
        correlationId: result.payload?.correlationId || correlationId || null,
        tenantId,
        profileId,
        applicationId,
        membershipId: memberId || null,
        exchange: "membership.events",
        routingKey: MEMBERSHIP_EVENTS.SUBSCRIPTION_UPSERT_REQUESTED,
        sourceService: "profile-service",
      });

      console.log(
        "✅ [APPLICATION_APPROVAL_PUBLISHER] Subscription upsert requested published successfully"
      );
    } catch (error) {
      bizLogger.error("RabbitMQ subscription upsert publish threw", {
        eventType: MEMBERSHIP_EVENTS.SUBSCRIPTION_UPSERT_REQUESTED,
        error: error.message,
        correlationId,
        tenantId,
        profileId,
        applicationId,
        membershipId: memberId || null,
        exchange: "membership.events",
        routingKey: MEMBERSHIP_EVENTS.SUBSCRIPTION_UPSERT_REQUESTED,
        sourceService: "profile-service",
      });
      console.error(
        "❌ [APPLICATION_APPROVAL_PUBLISHER] Error publishing subscription upsert requested:",
        { error: error.message, applicationId, profileId }
      );
      throw error;
    }
  }
}

module.exports = new ApplicationApprovalEventPublisher();

// Main RabbitMQ module exports - Now using shared middleware
const {
  init,
  publisher,
  consumer,
  EVENT_TYPES: MIDDLEWARE_EVENT_TYPES,
  shutdown,
} = require("@projectShell/rabbitmq-middleware");
const mongoose = require("mongoose");

// Import local event definitions
const {
  APPLICATION_REVIEW_EVENTS,
  APPLICATION_REVIEW_REJECTED_EVENTS,
  MEMBERSHIP_EVENTS,
} = require("./events/index.js");

// Import event handlers
const {
  handleProfileApplicationCreate,
} = require("./listeners/eventHandler.js");

// Import publishers
const ApplicationApprovalEventPublisher = require("./publishers/application.approval.publisher.js");

// Import listeners
const ApplicationApprovalEventListener = require("./listeners/application.approval.listener.js");
const {
  handleCrmUserCreated,
  handleCrmUserUpdated,
} = require("./listeners/user.crm.listener.js");
const {
  handlePortalUserCreated,
  handlePortalUserUpdated,
} = require("./listeners/user.portal.listener.js");
const {
  handleSubscriptionResignedInactive,
  handleSubscriptionCancelledInactive,
  handleSubscriptionResignationUndoneActive,
  handleSubscriptionCancellationUndoneActive,
} = require("./listeners/subscription.personal.details.listener.js");
// Initialize event system
async function initEventSystem() {
  try {
    await init({
      url: process.env.RABBIT_URL,
      logger: console,
      prefetch: 10,
      connectionName: "profile-service",
      serviceName: "profile-service",
    });
    console.log("✅ Event system initialized with middleware");
  } catch (error) {
    console.error("❌ Failed to initialize event system:", error.message);
    throw error;
  }
}

// Publish domain events using middleware
async function publishDomainEvent(eventType, data, metadata = {}) {
  const result = await publisher.publish(eventType, data, {
    tenantId: metadata.tenantId,
    correlationId: metadata.correlationId || generateEventId(),
    metadata: {
      service: "profile-service",
      version: "1.0",
      ...metadata,
    },
  });

  if (result.success) {
    console.log("✅ Domain event published:", eventType, result.eventId);
  } else {
    console.error(
      "❌ Failed to publish domain event:",
      eventType,
      result.error
    );
  }

  return result.success;
}

// Set up consumers using middleware
async function setupConsumers() {
  try {
    console.log("🔧 Setting up RabbitMQ consumers...");

    // 1. Portal service events queue (portal.events exchange)
    const PORTAL_QUEUE = "profile.portal.events";
    console.log("🔧 [SETUP] Creating portal queue...");
    console.log("   Queue:", PORTAL_QUEUE);
    console.log("   Exchange: portal.events");
    console.log("   Routing Key: profile.application.create");

    await consumer.createQueue(PORTAL_QUEUE, {
      durable: true,
      messageTtl: 3600000, // 1 hour
    });

    await consumer.bindQueue(PORTAL_QUEUE, "portal.events", [
      "profile.application.create",
    ]);

    consumer.registerHandler(
      "profile.application.create",
      async (payload, context) => {
        await handleProfileApplicationCreate(
          payload,
          context.routingKey,
          context.message
        );
      }
    );

    await consumer.consume(PORTAL_QUEUE, { prefetch: 10 });
    console.log("✅ Portal service events consumer ready:", PORTAL_QUEUE);
    console.log("   → profile.application.create from exchange portal.events → queue", PORTAL_QUEUE);

    // 2. Application events queue (application.events exchange) - for approval events
    const APPLICATION_QUEUE = "profile.application.events";
    console.log("🔧 [SETUP] Creating application queue...");
    console.log("   Queue:", APPLICATION_QUEUE);
    console.log("   Exchange: application.events");
    console.log("   Routing Key: applications.review.approved.v1");

    await consumer.createQueue(APPLICATION_QUEUE, {
      durable: true,
      messageTtl: 3600000, // 1 hour
    });

    await consumer.bindQueue(APPLICATION_QUEUE, "application.events", [
      "applications.review.approved.v1",
    ]);

    consumer.registerHandler(
      "applications.review.approved.v1",
      async (payload, context) => {
        await ApplicationApprovalEventListener.handleApplicationApproved(
          payload.data
        );
      }
    );

    await consumer.consume(APPLICATION_QUEUE, { prefetch: 10 });
    console.log("✅ Application events consumer ready:", APPLICATION_QUEUE);

    // 3. Membership events queue (membership.events exchange) - for membership events
    const MEMBERSHIP_QUEUE = "profile.membership.events";
    console.log("🔧 [SETUP] Creating membership queue...");
    console.log("   Queue:", MEMBERSHIP_QUEUE);
    console.log("   Exchange: membership.events");
    console.log(
      "   Routing Keys: members.member.created.requested.v1, members.subscription.current.updated.v1, members.subscription.resigned.v1, members.subscription.cancelled.v1, members.subscription.resignation.undone.v1, members.subscription.cancellation.undone.v1"
    );

    await consumer.createQueue(MEMBERSHIP_QUEUE, {
      durable: true,
      messageTtl: 3600000, // 1 hour
    });

    await consumer.bindQueue(MEMBERSHIP_QUEUE, "membership.events", [
      "members.member.created.requested.v1",
      "members.subscription.current.updated.v1",
      "members.subscription.resigned.v1",
      "members.subscription.cancelled.v1",
      "members.subscription.resignation.undone.v1",
      "members.subscription.cancellation.undone.v1",
    ]);

    consumer.registerHandler(
      "members.member.created.requested.v1",
      async (payload, context) => {
        await ApplicationApprovalEventListener.handleMemberCreatedRequested(
          payload.data
        );
      }
    );
    consumer.registerHandler(
      "members.subscription.current.updated.v1",
      async (payload, context) => {
        const { profileId, subscriptionId } = payload.data || {};
        if (!profileId || !subscriptionId) {
          console.warn(
            "[profile.membership.events] members.subscription.current.updated.v1 missing profileId or subscriptionId; skip",
            { correlationId: payload?.correlationId }
          );
          return;
        }
        const Profile = require("../models/profile.model.js");
        const { publishProfileAfterUpdateOne } = require("../services/profile.audit.publisher.js");
        const profile = await Profile.findById(profileId);
        if (!profile) {
          console.warn(
            "[profile.membership.events] members.subscription.current.updated.v1 no profile document for profileId; skip",
            { profileId, correlationId: payload?.correlationId }
          );
          return;
        }
        const beforeLean = profile.toObject({ depopulate: true });
        const data = payload.data || {};
        const update = { currentSubscriptionId: subscriptionId };
        if (
          profile.currentSubscriptionId &&
          String(profile.currentSubscriptionId) !== String(subscriptionId)
        ) {
          update.hasHistory = true;
        }
        if (data.renewalBatchId != null && String(data.renewalBatchId).trim() !== "") {
          const rid = String(data.renewalBatchId).trim();
          update.renewalBatchId = mongoose.Types.ObjectId.isValid(rid)
            ? new mongoose.Types.ObjectId(rid)
            : data.renewalBatchId;
        }
        await Profile.updateOne({ _id: profileId }, { $set: update });
        await publishProfileAfterUpdateOne({
          tenantId: profile.tenantId,
          profileId,
          beforeLean,
          actorId: null,
          source: "membership.subscription.current.updated",
        });
      }
    );

    consumer.registerHandler(
      "members.subscription.resigned.v1",
      async (payload) => {
        await handleSubscriptionResignedInactive(payload);
      }
    );

    consumer.registerHandler(
      "members.subscription.cancelled.v1",
      async (payload) => {
        await handleSubscriptionCancelledInactive(payload);
      }
    );

    consumer.registerHandler(
      "members.subscription.resignation.undone.v1",
      async (payload) => {
        await handleSubscriptionResignationUndoneActive(payload);
      }
    );
    consumer.registerHandler(
      "members.subscription.cancellation.undone.v1",
      async (payload) => {
        await handleSubscriptionCancellationUndoneActive(payload);
      }
    );

    await consumer.consume(MEMBERSHIP_QUEUE, { prefetch: 10 });
    console.log("✅ Membership events consumer ready:", MEMBERSHIP_QUEUE);

    // 4. User events queue (user.events exchange) - for CRM and Portal user events
    const USER_QUEUE = "profile.user.events";
    console.log("🔧 [SETUP] Creating user queue...");
    console.log("   Queue:", USER_QUEUE);
    console.log("   Exchange: user.events");
    console.log(
      "   Routing Keys: user.crm.created.v1, user.crm.updated.v1, user.portal.created.v1, user.portal.updated.v1"
    );

    await consumer.createQueue(USER_QUEUE, {
      durable: true,
      messageTtl: 3600000, // 1 hour
    });

    await consumer.bindQueue(USER_QUEUE, "user.events", [
      "user.crm.created.v1",
      "user.crm.updated.v1",
      "user.portal.created.v1",
      "user.portal.updated.v1",
    ]);

    consumer.registerHandler(
      "user.crm.created.v1",
      async (payload, context) => {
        await handleCrmUserCreated(payload);
      }
    );

    consumer.registerHandler(
      "user.crm.updated.v1",
      async (payload, context) => {
        await handleCrmUserUpdated(payload);
      }
    );

    consumer.registerHandler(
      "user.portal.created.v1",
      async (payload, context) => {
        await handlePortalUserCreated(payload);
      }
    );

    consumer.registerHandler(
      "user.portal.updated.v1",
      async (payload, context) => {
        await handlePortalUserUpdated(payload);
      }
    );

    await consumer.consume(USER_QUEUE, { prefetch: 10 });
    console.log("✅ User events consumer ready:", USER_QUEUE);

    console.log("✅ All consumers set up successfully");
  } catch (error) {
    console.error("❌ Failed to set up consumers:", error.message);
    console.error("❌ Stack trace:", error.stack);
    throw error;
  }
}

// Graceful shutdown using middleware
async function shutdownEventSystem() {
  try {
    await shutdown();
    console.log("✅ Event system shutdown complete");
  } catch (error) {
    console.error("❌ Error during event system shutdown:", error.message);
  }
}

// Utility function
function generateEventId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Export event types (merge middleware and local events)
const EVENT_TYPES = {
  ...MIDDLEWARE_EVENT_TYPES,
  ...APPLICATION_REVIEW_EVENTS,
  ...APPLICATION_REVIEW_REJECTED_EVENTS,
  ...MEMBERSHIP_EVENTS,
};

const QUEUES = {
  PORTAL_EVENTS: "profile.portal.events",
  APPLICATION_EVENTS: "profile.application.events",
  MEMBERSHIP_EVENTS: "profile.membership.events",
};

module.exports = {
  // Middleware functions
  init,
  publisher,
  consumer,
  shutdown,

  // Service functions
  EVENT_TYPES,
  QUEUES,
  APPLICATION_REVIEW_EVENTS,
  APPLICATION_REVIEW_REJECTED_EVENTS,
  MEMBERSHIP_EVENTS,
  initEventSystem,
  publishDomainEvent,
  setupConsumers,
  shutdownEventSystem,

  // Publishers
  ApplicationApprovalEventPublisher,

  // Listeners
  ApplicationApprovalEventListener,
};

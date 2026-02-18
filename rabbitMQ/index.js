// Main RabbitMQ module exports - Now using shared middleware
const {
  init,
  publisher,
  consumer,
  EVENT_TYPES: MIDDLEWARE_EVENT_TYPES,
  shutdown,
} = require("@projectShell/rabbitmq-middleware");

// Import local event definitions
const {
  APPLICATION_REVIEW_EVENTS,
  APPLICATION_REVIEW_REJECTED_EVENTS,
  MEMBERSHIP_EVENTS,
  BATCH_PROCESS_EVENTS,
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
const { runBatchProcessing } = require("../services/batch.process.job.service.js");

// Initialize event system
async function initEventSystem() {
  try {
    await init({
      url: process.env.RABBIT_URL,
      logger: console,
      prefetch: 10,
      connectionName: "profile-service",
      serviceName: "profile-service",
      exchanges: [
        { name: "batch.events", type: "topic", options: { durable: true } },
      ],
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
      "   Routing Keys: members.member.created.requested.v1, members.subscription.current.updated.v1"
    );

    await consumer.createQueue(MEMBERSHIP_QUEUE, {
      durable: true,
      messageTtl: 3600000, // 1 hour
    });

    await consumer.bindQueue(MEMBERSHIP_QUEUE, "membership.events", [
      "members.member.created.requested.v1",
      "members.subscription.current.updated.v1",
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
          return;
        }
        const Profile = require("../models/profile.model.js");
        const profile = await Profile.findById(profileId);
        if (!profile) return;
        const update = { currentSubscriptionId: subscriptionId };
        if (
          profile.currentSubscriptionId &&
          String(profile.currentSubscriptionId) !== String(subscriptionId)
        ) {
          update.hasHistory = true;
        }
        await Profile.updateOne({ _id: profileId }, { $set: update });
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

    // 5. Batch process queue (batch.events exchange) - background processing of batch details
    const BATCH_PROCESS_QUEUE = QUEUES.BATCH_PROCESS;
    console.log("🔧 [SETUP] Creating batch process queue...");
    console.log("   Queue:", BATCH_PROCESS_QUEUE);
    console.log("   Exchange: batch.events");
    console.log("   Routing Key:", BATCH_PROCESS_EVENTS.BATCH_PROCESS_REQUESTED);

    await consumer.createQueue(BATCH_PROCESS_QUEUE, {
      durable: true,
      messageTtl: 86400000, // 24 hours
    });

    await consumer.bindQueue(BATCH_PROCESS_QUEUE, "batch.events", [
      BATCH_PROCESS_EVENTS.BATCH_PROCESS_REQUESTED,
    ]);

    consumer.registerHandler(
      BATCH_PROCESS_EVENTS.BATCH_PROCESS_REQUESTED,
      async (payload, context) => {
        const data = payload.data || payload;
        const { batchDetailId, tenantId, userId, authorization } = data;
        if (!batchDetailId) {
          console.error("[BatchProcess] Missing batchDetailId in payload");
          return;
        }
        const result = await runBatchProcessing(batchDetailId, tenantId || null, {
          authorization: authorization || undefined,
        });
        // Publish completion event for future WebSocket/notification service
        await publisher.publish(
          BATCH_PROCESS_EVENTS.BATCH_PROCESS_COMPLETED,
          {
            batchDetailId,
            userId: userId || null,
            tenantId: tenantId || null,
            success: result.success,
            processed: result.processed,
            failed: result.failed,
            message: result.message,
          },
          {
            tenantId: tenantId || undefined,
            exchange: "batch.events",
            routingKey: BATCH_PROCESS_EVENTS.BATCH_PROCESS_COMPLETED,
            metadata: { service: "profile-service", version: "1.0" },
          }
        );
        if (result.success) {
          console.log("✅ [BatchProcess] Completed batch:", batchDetailId, "processed:", result.processed, "failed:", result.failed);
        } else {
          console.warn("⚠️ [BatchProcess] Batch failed:", batchDetailId, result.message);
        }
      }
    );

    await consumer.consume(BATCH_PROCESS_QUEUE, { prefetch: 1 });
    console.log("✅ Batch process consumer ready:", BATCH_PROCESS_QUEUE);

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
  ...BATCH_PROCESS_EVENTS,
};

const QUEUES = {
  PORTAL_EVENTS: "profile.portal.events",
  APPLICATION_EVENTS: "profile.application.events",
  MEMBERSHIP_EVENTS: "profile.membership.events",
  BATCH_PROCESS: "profile.batch.process",
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
  BATCH_PROCESS_EVENTS,
  initEventSystem,
  publishDomainEvent,
  setupConsumers,
  shutdownEventSystem,

  // Publishers
  ApplicationApprovalEventPublisher,

  // Listeners
  ApplicationApprovalEventListener,
};

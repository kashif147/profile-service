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
} = require("./events/index.js");

// Import event handlers
const {
  handleProfileApplicationCreate,
} = require("./listeners/eventHandler.js");

// Initialize event system
async function initEventSystem() {
  try {
    await init({
      url: process.env.RABBIT_URL,
      logger: console,
      prefetch: 10,
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

    // Portal service events queue (portal.events exchange)
    const PORTAL_QUEUE = "profile.portal.events";
    console.log("🔧 [SETUP] Creating portal queue...");
    console.log("   Queue:", PORTAL_QUEUE);
    console.log("   Exchange: portal.events");
    console.log("   Routing Key: profile.application.create");

    // Create queue with DLQ support
    await consumer.createQueue(PORTAL_QUEUE, {
      durable: true,
      messageTtl: 3600000, // 1 hour
    });

    // Bind to exchange
    await consumer.bindQueue(PORTAL_QUEUE, "portal.events", [
      "profile.application.create",
    ]);

    // Register handler
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

    // Start consuming
    await consumer.consume(PORTAL_QUEUE, { prefetch: 10 });
    console.log("✅ Portal service events consumer ready:", PORTAL_QUEUE);

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
};

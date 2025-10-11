const { publishEvent } = require("./publisher.js");
const {
  initConsumer,
  createQueue,
  consumeQueue,
  stopAllConsumers,
} = require("./consumer.js");

const {
  handleProfileApplicationCreate,
} = require("./listeners/eventHandler.js");

// Initialize event system
async function initEventSystem() {
  try {
    await initConsumer();
    console.log("✅ Event system initialized");
  } catch (error) {
    console.error("❌ Failed to initialize event system:", error.message);
    throw error;
  }
}

// Publish events with standardized payload structure
async function publishDomainEvent(eventType, data, metadata = {}) {
  const payload = {
    eventId: generateEventId(),
    eventType,
    timestamp: new Date().toISOString(),
    data,
    metadata: {
      service: "profile-service",
      version: "1.0",
      ...metadata,
    },
  };

  const success = await publishEvent(eventType, payload);

  if (success) {
    console.log("✅ Domain event published:", eventType, payload.eventId);
  } else {
    console.error(
      "❌ Failed to publish domain event:",
      eventType,
      payload.eventId
    );
  }

  return success;
}

// Set up consumers for different event types
async function setupConsumers() {
  try {
    console.log("🔧 Setting up RabbitMQ consumers...");

    // Portal service events queue (portal.events exchange)
    const PORTAL_QUEUE = "profile.portal.events";
    console.log("🔧 [SETUP] Creating portal queue...");
    console.log("   Queue:", PORTAL_QUEUE);
    console.log("   Exchange: portal.events");
    console.log("   Routing Key: profile.application.create");

    await createQueue(PORTAL_QUEUE, "portal.events", [
      "profile.application.create",
    ]);
    await consumeQueue(PORTAL_QUEUE, handleProfileApplicationCreate);
    console.log("✅ Portal service events consumer ready:", PORTAL_QUEUE);

    console.log("✅ All consumers set up successfully");
  } catch (error) {
    console.error("❌ Failed to set up consumers:", error.message);
    console.error("❌ Stack trace:", error.stack);
    throw error;
  }
}

// Utility functions
function generateEventId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Graceful shutdown
async function shutdownEventSystem() {
  try {
    await stopAllConsumers();
    console.log("✅ Event system shutdown complete");
  } catch (error) {
    console.error("❌ Error during event system shutdown:", error.message);
  }
}

module.exports = {
  initEventSystem,
  publishDomainEvent,
  setupConsumers,
  shutdownEventSystem,
};

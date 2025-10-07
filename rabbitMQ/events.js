const { publishEvent } = require("./publisher.js");
const {
  initConsumer,
  createQueue,
  consumeQueue,
  stopAllConsumers,
} = require("./consumer.js");

// Import event types and handlers from separate event files
const {
  APPLICATION_EVENTS,
  APPLICATION_QUEUES,
  handleApplicationEvent,
} = require("./events/index.js");

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
      service: "portal-service",
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
    // Application processing queue
    await createQueue(APPLICATION_QUEUES.APPLICATION_PROCESSING, [
      "application.*",
    ]);
    await consumeQueue(
      APPLICATION_QUEUES.APPLICATION_PROCESSING,
      handleApplicationEvent
    );

    console.log("✅ All consumers set up successfully");
  } catch (error) {
    console.error("❌ Failed to set up consumers:", error.message);
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
  EVENT_TYPES: APPLICATION_EVENTS,
  QUEUES: APPLICATION_QUEUES,
  initEventSystem,
  publishDomainEvent,
  setupConsumers,
  shutdownEventSystem,
};

const ApplicationStatusUpdateListener = require("../listeners/applicationStatusUpdateListener");
const ApplicationApprovedListener = require("../listeners/applicationApprovedListener");
const ApplicationRejectedListener = require("../listeners/applicationRejectedListener");

// Application Events
const APPLICATION_EVENTS = {
  STATUS_UPDATED: "application.status.updated",
  APPROVED: "application.approved",
  REJECTED: "application.rejected",
};

// Application Queues
const APPLICATION_QUEUES = {
  APPLICATION_PROCESSING: "portal.application.processing",
};

// Application event handlers
async function handleApplicationEvent(payload, routingKey, msg) {
  console.log("📥 Processing application event:", {
    routingKey,
    eventId: payload.eventId,
  });

  try {
    const { eventType, data } = payload;

    switch (eventType) {
      case APPLICATION_EVENTS.STATUS_UPDATED:
        await ApplicationStatusUpdateListener.handleApplicationStatusUpdate(
          data
        );
        break;
      case APPLICATION_EVENTS.APPROVED:
        await ApplicationApprovedListener.handleApplicationApproved(data);
        break;
      case APPLICATION_EVENTS.REJECTED:
        await ApplicationRejectedListener.handleApplicationRejected(data);
        break;
      default:
        console.warn("⚠️ Unknown application event type:", eventType);
    }
  } catch (error) {
    console.error("❌ Error handling application event:", error.message);
    throw error;
  }
}

module.exports = {
  APPLICATION_EVENTS,
  APPLICATION_QUEUES,
  handleApplicationEvent,
};

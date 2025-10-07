const ProfileApplicationUpdateListener = require("../listeners/profileApplicationUpdateListener");
const ProfileMemberCreatedListener = require("../listeners/profileMemberCreatedListener");
const ProfileMemberUpdatedListener = require("../listeners/profileMemberUpdatedListener");

// Profile Events
const PROFILE_EVENTS = {
  APPLICATION_UPDATED: "profile.service.application.updated",
  MEMBER_CREATED: "profile.service.member.created",
  MEMBER_UPDATED: "profile.service.member.updated",
};

// Profile event handlers
async function handleProfileEvent(payload, routingKey, msg) {
  console.log("📥 Processing profile event:", {
    routingKey,
    eventId: payload.eventId,
  });

  try {
    const { eventType, data } = payload;

    switch (eventType) {
      case PROFILE_EVENTS.APPLICATION_UPDATED:
        await ProfileApplicationUpdateListener.handleProfileApplicationUpdate(
          data
        );
        break;
      case PROFILE_EVENTS.MEMBER_CREATED:
        await ProfileMemberCreatedListener.handleProfileMemberCreated(data);
        break;
      case PROFILE_EVENTS.MEMBER_UPDATED:
        await ProfileMemberUpdatedListener.handleProfileMemberUpdated(data);
        break;
      default:
        console.warn("⚠️ Unknown profile event type:", eventType);
    }
  } catch (error) {
    console.error("❌ Error handling profile event:", error.message);
    throw error;
  }
}

module.exports = {
  PROFILE_EVENTS,
  handleProfileEvent,
};

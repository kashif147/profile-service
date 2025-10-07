// Export all event types and handlers from individual event files
const {
  APPLICATION_EVENTS,
  APPLICATION_QUEUES,
  handleApplicationEvent,
} = require("./application.events.js");

const { PROFILE_EVENTS, handleProfileEvent } = require("./profile.events.js");

// Combined event types for backward compatibility
const EVENT_TYPES = {
  // Application events
  ...APPLICATION_EVENTS,
  // Profile events
  ...PROFILE_EVENTS,
};

// Combined queue names
const QUEUES = {
  ...APPLICATION_QUEUES,
};

module.exports = {
  EVENT_TYPES,
  QUEUES,
  APPLICATION_EVENTS,
  APPLICATION_QUEUES,
  handleApplicationEvent,
  PROFILE_EVENTS,
  handleProfileEvent,
};

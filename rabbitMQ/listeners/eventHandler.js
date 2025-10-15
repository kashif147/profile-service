const ProfileApplicationCreateEventListener = require("./profile.application.create.listener.js");

// Route incoming events to appropriate listeners
// This is a thin routing layer - shared middleware handles technical logging/ACK/NACK
// Listeners handle business logic and business-specific logging
async function handleProfileApplicationCreate(payload, routingKey, msg) {
  const { data } = payload;
  await ProfileApplicationCreateEventListener.handleProfileApplicationCreate(
    data
  );
}

module.exports = {
  handleProfileApplicationCreate,
};

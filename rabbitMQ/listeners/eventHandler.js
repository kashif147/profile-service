const ProfileApplicationCreateListener = require("./profile.application.create.listerner.js");

// Route incoming events to appropriate listeners
// This is a thin routing layer - consumer.js handles technical logging/ACK/NACK
// Listeners handle business logic and business-specific logging
async function handleProfileApplicationCreate(payload, routingKey, msg) {
  const { data } = payload;
  await ProfileApplicationCreateListener.handleProfileApplicationCreate(data);
}

module.exports = {
  handleProfileApplicationCreate,
};

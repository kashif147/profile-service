const ProfileApplicationCreateListener = require("./profile.application.create.listerner.js");

class ProfileApplicationCreateEventListener {
  constructor() {
    // This listener handles profile.application.create events from portal service
  }

  async handleProfileApplicationCreate(data) {
    try {
      console.log(
        "📥 [PROFILE_APPLICATION_CREATE_LISTENER] Received profile application create event:",
        {
          applicationId: data.applicationId,
          status: data.status,
          tenantId: data.tenantId,
          timestamp: new Date().toISOString(),
        }
      );

      // Delegate to the existing listener
      await ProfileApplicationCreateListener.handleProfileApplicationCreate(
        data
      );

      console.log(
        "✅ [PROFILE_APPLICATION_CREATE_LISTENER] Profile application create event processed successfully"
      );
    } catch (error) {
      console.error(
        "❌ [PROFILE_APPLICATION_CREATE_LISTENER] Error handling profile application create event:",
        {
          error: error.message,
          applicationId: data?.applicationId,
        }
      );
      throw error;
    }
  }
}

module.exports = new ProfileApplicationCreateEventListener();

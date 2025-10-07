const { publishDomainEvent } = require("../events.js");

class ProfileMemberUpdatedListener {
  constructor() {
    // This listener handles profile.service.member.updated events
  }

  async handleProfileMemberUpdated(data) {
    try {
      console.log("📥 Received profile member updated event:", data);

      const {
        applicationId,
        userId,
        personalDetails,
        professionalDetails,
        subscriptionDetails,
        updateType,
        changes,
      } = data;

      console.log("✅ Processing member update for:", applicationId);

      // This handler can be extended to:
      // - Sync changes to external systems
      // - Send update notifications
      // - Update member records in CRM
      // - Trigger audit logs
      // - Update analytics
      // - Send change confirmations

      // Example: Emit event for external system sync
      await publishDomainEvent("external.system.member.update", {
        applicationId: applicationId,
        userId: userId,
        updateType: updateType,
        changes: changes,
        memberData: {
          personal: personalDetails,
          professional: professionalDetails,
          subscription: subscriptionDetails,
        },
      });

      console.log("✅ Profile member updated event processed successfully");
    } catch (error) {
      console.error("❌ Error handling profile member updated:", error.message);
    }
  }
}

module.exports = new ProfileMemberUpdatedListener();

const { publishDomainEvent } = require("../events.js");

class ProfileApplicationUpdateListener {
  constructor() {
    // This listener handles profile.service.application.updated events
  }

  async handleProfileApplicationUpdate(data) {
    try {
      console.log("📥 Received profile application update event:", data);

      const {
        applicationId,
        tenantId,
        status,
        personalDetails,
        professionalDetails,
        subscriptionDetails,
        paymentDetails,
      } = data;

      console.log(
        "✅ Processing profile application update for:",
        applicationId
      );

      // This handler can be extended to:
      // - Update member profiles in external systems
      // - Send notifications to relevant parties
      // - Trigger other downstream processes
      // - Update CRM systems
      // - Generate reports
      // - Update analytics

      // Example: Emit event for external system integration
      await publishDomainEvent("external.system.member.sync", {
        applicationId: applicationId,
        tenantId: tenantId,
        status: status,
        memberData: {
          personal: personalDetails,
          professional: professionalDetails,
          subscription: subscriptionDetails,
        },
        paymentDetails: paymentDetails,
      });

      console.log("✅ Profile application update processed successfully");
    } catch (error) {
      console.error(
        "❌ Error handling profile application update:",
        error.message
      );
    }
  }
}

module.exports = new ProfileApplicationUpdateListener();

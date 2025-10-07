const { publishDomainEvent } = require("../events.js");

class ProfileMemberCreatedListener {
  constructor() {
    // This listener handles profile.service.member.created events
  }

  async handleProfileMemberCreated(data) {
    try {
      console.log("📥 Received profile member created event:", data);

      const {
        applicationId,
        userId,
        personalDetails,
        subscriptionDetails,
        approvalDetails,
      } = data;

      console.log("✅ Processing new member creation for:", applicationId);

      // This handler can be extended to:
      // - Send welcome email to new member
      // - Create member profile in external systems
      // - Generate member ID cards
      // - Set up member portal access
      // - Send onboarding notifications
      // - Update member statistics

      // Example: Emit event for member onboarding
      await publishDomainEvent("member.onboarding.initiated", {
        applicationId: applicationId,
        userId: userId,
        memberData: {
          personal: personalDetails,
          subscription: subscriptionDetails,
        },
        onboardingDetails: {
          membershipNumber: subscriptionDetails?.membershipNumber,
          approvedAt: approvalDetails?.approvedAt,
        },
      });

      console.log("✅ Profile member created event processed successfully");
    } catch (error) {
      console.error("❌ Error handling profile member created:", error.message);
    }
  }
}

module.exports = new ProfileMemberCreatedListener();

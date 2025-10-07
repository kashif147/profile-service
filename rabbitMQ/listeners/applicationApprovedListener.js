const { publishDomainEvent } = require("../events.js");
const PersonalDetails = require("../../models/personal.details.model");
const SubscriptionDetails = require("../../models/subscription.model");

class ApplicationApprovedListener {
  constructor() {
    // This listener handles application.approved events
  }

  async handleApplicationApproved(data) {
    try {
      console.log("📥 Received application approved event:", data);

      const {
        personalDetailsId,
        userId,
        subscriptionDetails,
        approvalDetails,
      } = data;

      // Find the personal details record
      const personalDetails = await PersonalDetails.findById(personalDetailsId);
      if (!personalDetails) {
        console.error(
          "❌ Personal details not found for ID:",
          personalDetailsId
        );
        return;
      }

      // Update application status to approved
      const updateData = {
        applicationStatus: "approved",
        approvalDetails: {
          ...approvalDetails,
          approvedAt: new Date(),
        },
      };

      const updatedPersonalDetails = await PersonalDetails.findByIdAndUpdate(
        personalDetailsId,
        updateData,
        { new: true }
      );

      console.log("✅ Application approved:", personalDetails.ApplicationId);

      // Generate membership number if not exists
      if (subscriptionDetails && !subscriptionDetails.membershipNumber) {
        const membershipNumberGenerator = require("../../helpers/membership.number.generator");
        const membershipNumber =
          await membershipNumberGenerator.generateMembershipNumber();

        await SubscriptionDetails.findByIdAndUpdate(
          subscriptionDetails._id,
          { membershipNumber: membershipNumber },
          { new: true }
        );

        console.log("✅ Membership number generated:", membershipNumber);
      }

      // Emit member created event for profile service
      await publishDomainEvent("profile.service.member.created", {
        applicationId: personalDetails.ApplicationId,
        userId: userId,
        personalDetails: updatedPersonalDetails,
        subscriptionDetails: subscriptionDetails,
        approvalDetails: updateData.approvalDetails,
      });

      console.log("✅ Member created event emitted successfully");
    } catch (error) {
      console.error("❌ Error handling application approved:", error.message);
    }
  }
}

module.exports = new ApplicationApprovedListener();

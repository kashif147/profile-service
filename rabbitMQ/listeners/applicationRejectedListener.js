const { publishDomainEvent } = require("../events.js");
const PersonalDetails = require("../../models/personal.details.model");

class ApplicationRejectedListener {
  constructor() {
    // This listener handles application.rejected events
  }

  async handleApplicationRejected(data) {
    try {
      console.log("📥 Received application rejected event:", data);

      const { personalDetailsId, userId, approvalDetails } = data;

      // Find the personal details record
      const personalDetails = await PersonalDetails.findById(personalDetailsId);
      if (!personalDetails) {
        console.error(
          "❌ Personal details not found for ID:",
          personalDetailsId
        );
        return;
      }

      // Update application status to rejected
      const updateData = {
        applicationStatus: "rejected",
        approvalDetails: {
          ...approvalDetails,
          rejectedAt: new Date(),
        },
      };

      const updatedPersonalDetails = await PersonalDetails.findByIdAndUpdate(
        personalDetailsId,
        updateData,
        { new: true }
      );

      console.log("✅ Application rejected:", personalDetails.ApplicationId);

      // Emit notification event for user
      await publishDomainEvent("notification.application.rejected", {
        applicationId: personalDetails.ApplicationId,
        userId: userId,
        personalDetails: updatedPersonalDetails,
        rejectionReason: approvalDetails.rejectionReason,
        comments: approvalDetails.comments,
      });

      console.log("✅ Application rejection notification event emitted");
    } catch (error) {
      console.error("❌ Error handling application rejected:", error.message);
    }
  }
}

module.exports = new ApplicationRejectedListener();

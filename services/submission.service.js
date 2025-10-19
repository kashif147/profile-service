// services/submission.service.js
const PersonalDetails = require("../models/personal.details.model.js");
const ProfessionalDetails = require("../models/professional.details.model.js");
const SubscriptionDetails = require("../models/subscription.model.js");

async function loadSubmission(applicationId) {
  try {
    // Load all related data for the application
    const [personalDetails, professionalDetails, subscriptionDetails] =
      await Promise.all([
        PersonalDetails.findOne({ ApplicationId: applicationId }).lean(),
        ProfessionalDetails.findOne({ ApplicationId: applicationId }).lean(),
        SubscriptionDetails.findOne({ ApplicationId: applicationId }).lean(),
      ]);

    // Log loaded data for debugging
    console.log(`Loaded submission data for application ${applicationId}:`, {
      personalDetails: !!personalDetails,
      professionalDetails: !!professionalDetails,
      subscriptionDetails: !!subscriptionDetails,
    });

    // Combine into submission format
    const submission = {
      personalInfo: personalDetails?.personalInfo || {},
      contactInfo: personalDetails?.contactInfo || {},
      professionalDetails: professionalDetails?.professionalDetails || {},
      subscriptionDetails: subscriptionDetails?.subscriptionDetails || {},
    };

    const meta = {
      personalDetailsId: personalDetails?._id,
      professionalDetailsId: professionalDetails?._id,
      subscriptionDetailsId: subscriptionDetails?._id,
      lastUpdated: new Date(),
    };

    console.log(
      `Submission structure for application ${applicationId}:`,
      JSON.stringify(submission, null, 2)
    );

    return { submission, meta };
  } catch (error) {
    console.error(
      `Failed to load submission for application ${applicationId}:`,
      error
    );
    throw new Error(
      `Failed to load submission for application ${applicationId}: ${error.message}`
    );
  }
}

module.exports = { loadSubmission };

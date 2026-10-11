// services/submission.service.js
const PersonalDetails = require("../models/personal.details.model.js");
const ProfessionalDetails = require("../models/professional.details.model.js");
const SubscriptionDetails = require("../models/subscription.model.js");
const { AppError } = require("../errors/AppError.js");
const {
  mergeLegacyProfessionalFieldsFromSubscription,
  readLegacyProfessionalFieldsFromSubscriptionRecord,
} = require("../helpers/membershipCategory.helper.js");

/**
 * Load the authoritative staging submission for an application, scoped to the
 * trusted tenant. `tenantId` is required: without it nothing is loaded (an empty
 * submission is returned and `meta.found` is false) rather than reading another
 * tenant's application.
 */
async function loadSubmission(applicationId, tenantId) {
  const scopedTenantId = tenantId == null ? "" : String(tenantId).trim();
  if (!scopedTenantId) {
    throw AppError.forbidden("Tenant context is required");
  }
  try {
    console.log(
      `[loadSubmission] Starting load for applicationId: ${applicationId}`
    );

    // Load all related data for the application
    const [personalDetails, professionalDetails, subscriptionDetails] =
      await Promise.all([
        PersonalDetails.findOne({ applicationId, tenantId: scopedTenantId }).lean(),
        ProfessionalDetails.findOne({ applicationId, tenantId: scopedTenantId }).lean(),
        SubscriptionDetails.findOne({ applicationId, tenantId: scopedTenantId }).lean(),
      ]);

    console.log(
      `[loadSubmission] Database queries completed for applicationId: ${applicationId}`
    );

    // Log loaded data for debugging
    console.log(`Loaded submission data for application ${applicationId}:`, {
      personalDetails: !!personalDetails,
      professionalDetails: !!professionalDetails,
      subscriptionDetails: !!subscriptionDetails,
    });

    // Combine into submission format
    const rawProfessionalDetails =
      professionalDetails?.professionalDetails || {};
    const legacyProfessionalFields =
      await readLegacyProfessionalFieldsFromSubscriptionRecord(
        subscriptionDetails,
      );
    let professionalDetailsPayload = mergeLegacyProfessionalFieldsFromSubscription(
      { ...rawProfessionalDetails },
      legacyProfessionalFields,
    );
    delete professionalDetailsPayload.membershipCategory;

    const subscriptionDetailsPayload = {
      ...(subscriptionDetails?.subscriptionDetails || {}),
    };

    if (
      subscriptionDetailsPayload.membershipCategory == null &&
      rawProfessionalDetails?.membershipCategory
    ) {
      subscriptionDetailsPayload.membershipCategory =
        rawProfessionalDetails.membershipCategory;
    }

    const submission = {
      personalInfo: personalDetails?.personalInfo || {},
      contactInfo: personalDetails?.contactInfo || {},
      professionalDetails: professionalDetailsPayload,
      subscriptionDetails: subscriptionDetailsPayload,
      paymentDetails: subscriptionDetails?.paymentDetails || null,
      userId: personalDetails?.userId || null,
      userType: personalDetails?.meta?.userType || null,
    };

    const meta = {
      found: !!personalDetails,
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
      `[loadSubmission] Failed to load submission for application ${applicationId}:`,
      error
    );
    console.error(`[loadSubmission] Error stack:`, error.stack);
    console.error(`[loadSubmission] Error name:`, error.name);
    console.error(`[loadSubmission] Error message:`, error.message);
    throw AppError.internalServerError("Failed to load submission");
  }
}

module.exports = { loadSubmission };

/**
 * Aggregated User Details Controller
 * API: get personal, professional, and subscription details for the current user.
 * First from profile-service (by email from token, then applicationId for pro/sub).
 * If not present in profile-service, uses gateway aggregation (portal-service) when configured.
 * Response format matches individual my-personal-details / my-professional-details / my-subscription-details.
 */

const { AppError } = require("../errors/AppError");
const { extractUserAndCreatorContext } = require("../helpers/get.user.info.js");
const aggregatedUserDetailsService = require("../services/aggregated.user.details.service.js");

/**
 * GET /api/profile/aggregated-user-details
 * Returns personal, professional, and subscription details in the same format as individual calls.
 * - Email is extracted from the user token (or x-user-email).
 * - Personal details are looked up by email (personalEmail or workEmail).
 * - Professional and subscription are fetched by applicationId (replication ID) from personal details.
 * - If nothing found in profile-service, falls back to portal-service when PORTAL_SERVICE_URL is set (gateway aggregation).
 * Only available for PORTAL users.
 */
async function getAggregatedUserDetails(req, res, next) {
  try {
    const { userType } = extractUserAndCreatorContext(req);
    if (userType !== "PORTAL") {
      return next(
        AppError.forbidden("This endpoint is only available for Portal users")
      );
    }
    const result =
      await aggregatedUserDetailsService.getAggregatedUserDetails(req);

    const hasAny =
      result.personalDetails ||
      result.professionalDetails ||
      result.subscriptionDetails;

    if (!hasAny) {
      return res.status(200).json({
        data: {
          personalDetails: null,
          professionalDetails: null,
          subscriptionDetails: null,
          personalDetailsSource: "profile-service",
          professionalDetailsSource: "profile-service",
          subscriptionDetailsSource: "profile-service",
        },
        message: "No details found. Try gateway aggregation (portal-service) if configured.",
      });
    }

    return res.success(result);
  } catch (error) {
    console.error(
      "AggregatedUserDetailsController [getAggregatedUserDetails] Error:",
      error
    );
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch aggregated user details"
      )
    );
  }
}

module.exports = {
  getAggregatedUserDetails,
};

/**
 * Aggregated User Details Service
 * Fetches personal, professional, and subscription details for the current user:
 * - First from profile-service (by email from token, then applicationId for pro/sub).
 * - Response in same format as individual my-personal-details, my-professional-details, my-subscription-details.
 */

const personalDetailsService = require("./personal.details.service.js");
const personalDetailsHandler = require("../handlers/personal.details.handler.js");
const professionalDetailsHandler = require("../handlers/professional.details.handler.js");
const subscriptionDetailsHandler = require("../handlers/subscription.details.handler.js");

const SOURCE_PROFILE_SERVICE = "profile-service";
const SOURCE_PORTAL_SERVICE = "portal-service";

/**
 * Extract email from the request (user token or gateway headers).
 * Tries: req.user.email, x-user-email, req.user.preferred_username.
 * @param {Object} req - Express request
 * @returns {string|null} Email or null
 */
function extractEmailFromToken(req) {
  if (!req || !req.user) return null;
  const email =
    req.user.email ||
    req.headers["x-user-email"] ||
    req.user.preferred_username ||
    req.user.preferredEmail;
  if (typeof email !== "string" || !email.trim()) return null;
  return email.trim();
}

/**
 * Get personal details by email (matches contactInfo.personalEmail or contactInfo.workEmail).
 * @param {string} email - User email
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object|null>} Personal details document or null
 */
async function getPersonalDetailsByEmail(email, tenantId) {
  if (!email) return null;
  return personalDetailsService.getPersonalDetailsByEmail(email, tenantId);
}

/**
 * Get professional details by application ID (replication ID from personal details).
 * @param {string} applicationId - Application ID from personal details
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object|null>} Professional details document or null
 */
async function getProfessionalDetailsByApplicationId(
  applicationId,
  tenantId
) {
  if (!applicationId) return null;
  return professionalDetailsHandler.getByApplicationId(
    applicationId,
    tenantId
  );
}

/**
 * Get subscription details by application ID (replication ID from personal details).
 * @param {string} applicationId - Application ID from personal details
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object|null>} Subscription details document or null
 */
async function getSubscriptionDetailsByApplicationId(
  applicationId,
  tenantId
) {
  if (!applicationId) return null;
  return subscriptionDetailsHandler.getByApplicationId(
    applicationId,
    tenantId
  );
}

/**
 * Fetch aggregated user details from profile-service only.
 * 1) Get email from token.
 * 2) Find personal details by email (personalEmail or workEmail).
 * 3) If personal found, use applicationId to fetch professional and subscription details.
 * @param {Object} req - Express request (must have req.user, req.tenantId)
 * @returns {Promise<{ personalDetails: Object|null, professionalDetails: Object|null, subscriptionDetails: Object|null, personalDetailsSource: string, professionalDetailsSource: string, subscriptionDetailsSource: string }>}
 */
async function getAggregatedFromProfileService(req) {
  const tenantId = req.tenantId;
  const email = extractEmailFromToken(req);

  const result = {
    personalDetails: null,
    professionalDetails: null,
    subscriptionDetails: null,
    personalDetailsSource: SOURCE_PROFILE_SERVICE,
    professionalDetailsSource: SOURCE_PROFILE_SERVICE,
    subscriptionDetailsSource: SOURCE_PROFILE_SERVICE,
  };

  if (!email) {
    return result;
  }

  const personalDetails = await getPersonalDetailsByEmail(email, tenantId);
  result.personalDetails = personalDetails || null;

  if (!personalDetails || !personalDetails.applicationId) {
    return result;
  }

  const applicationId = personalDetails.applicationId;

  const [professionalDetails, subscriptionDetails] = await Promise.all([
    getProfessionalDetailsByApplicationId(applicationId, tenantId),
    getSubscriptionDetailsByApplicationId(applicationId, tenantId),
  ]);

  result.professionalDetails = professionalDetails || null;
  result.subscriptionDetails = subscriptionDetails || null;

  return result;
}

/**
 * Fetch aggregated user details from portal-service (gateway aggregation).
 * Used when profile-service has no data. Calls portal-service if configured.
 * @param {Object} req - Express request (userId, tenantId)
 * @returns {Promise<{ personalDetails: Object|null, professionalDetails: Object|null, subscriptionDetails: Object|null, personalDetailsSource: string, professionalDetailsSource: string, subscriptionDetailsSource: string }|null>}
 *   Null if portal is not configured or request fails.
 */
async function getAggregatedFromPortalService(req) {
  const portalBaseUrl = process.env.PORTAL_SERVICE_URL;
  if (!portalBaseUrl || !portalBaseUrl.trim()) {
    return null;
  }

  const userId = req.userId || req.user?.sub || req.user?.id;
  const tenantId = req.tenantId;
  if (!userId || !tenantId) {
    return null;
  }

  try {
    const axios = require("axios");
    const url = `${portalBaseUrl.replace(/\/$/, "")}/api/user/my-details`;
    const authHeader =
      req.headers?.authorization || req.headers?.Authorization;
    const response = await axios.get(url, {
      headers: {
        Authorization: authHeader || "",
        "x-tenant-id": tenantId,
        "Content-Type": "application/json",
      },
      timeout: 10000,
      validateStatus: () => true,
    });

    if (response.status !== 200 || !response.data) {
      return null;
    }

    const data = response.data.data || response.data;
    return {
      personalDetails: data.personalDetails ?? null,
      professionalDetails: data.professionalDetails ?? null,
      subscriptionDetails: data.subscriptionDetails ?? null,
      personalDetailsSource: SOURCE_PORTAL_SERVICE,
      professionalDetailsSource: SOURCE_PORTAL_SERVICE,
      subscriptionDetailsSource: SOURCE_PORTAL_SERVICE,
    };
  } catch (err) {
    console.error(
      "[aggregated.user.details.service] Portal fallback error:",
      err.message
    );
    return null;
  }
}

/**
 * Get aggregated user details: try profile-service first, then portal-service (gateway aggregation).
 * Response format matches individual calls (same shape as my-personal-details, my-professional-details, my-subscription-details).
 * @param {Object} req - Express request
 * @returns {Promise<Object>} { personalDetails, professionalDetails, subscriptionDetails, personalDetailsSource, professionalDetailsSource, subscriptionDetailsSource }
 */
async function getAggregatedUserDetails(req) {
  const fromProfile = await getAggregatedFromProfileService(req);

  const hasAnyFromProfile =
    fromProfile.personalDetails ||
    fromProfile.professionalDetails ||
    fromProfile.subscriptionDetails;

  if (hasAnyFromProfile) {
    return fromProfile;
  }

  const fromPortal = await getAggregatedFromPortalService(req);
  if (fromPortal) {
    return fromPortal;
  }

  return fromProfile;
}

module.exports = {
  extractEmailFromToken,
  getPersonalDetailsByEmail,
  getProfessionalDetailsByApplicationId,
  getSubscriptionDetailsByApplicationId,
  getAggregatedFromProfileService,
  getAggregatedFromPortalService,
  getAggregatedUserDetails,
  SOURCE_PROFILE_SERVICE,
  SOURCE_PORTAL_SERVICE,
};

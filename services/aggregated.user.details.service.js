/**
 * Aggregated User Details Service
 * - Supports both portal-created users (by userId) and CRM-created users (by email).
 * - First checks portal service; if portal has data and the same email exists in profile service, returns from profile; otherwise returns from portal.
 * - If portal has no data, returns from profile (userId first for portal-created, then email for CRM-created).
 * Response format matches individual my-personal-details, my-professional-details, my-subscription-details.
 */

const personalDetailsService = require("./personal.details.service.js");
const professionalDetailsService = require("./professional.details.service.js");
const subscriptionDetailsService = require("./subscription.details.service.js");
const personalDetailsHandler = require("../handlers/personal.details.handler.js");
const professionalDetailsHandler = require("../handlers/professional.details.handler.js");
const subscriptionDetailsHandler = require("../handlers/subscription.details.handler.js");
const {
  fetchCurrentSubscriptionByProfileId,
  mergeSubscriptionServiceData,
} = require("./subscription.service.client.js");
const Profile = require("../models/profile.model.js");

const SOURCE_PROFILE_SERVICE = "profile-service";
const SOURCE_PORTAL_SERVICE = "portal-service";

/**
 * Extract email from the request (user token or gateway headers).
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
 * Extract userId from the request.
 * @param {Object} req - Express request
 * @returns {string|null} User ID or null
 */
function extractUserId(req) {
  if (!req) return null;
  return (
    req.userId ||
    req.user?.sub ||
    req.user?.id ||
    req.user?._id ||
    req.headers["x-user-id"]
  ) || null;
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
 * Fetch from profile-service: try portal-created (by userId) first, then CRM-created (by email).
 * Portal-created: getMyPersonalDetails(userId), getMyProfessionalDetails(userId), getMySubscriptionDetails(userId).
 * CRM-created: getPersonalDetailsByEmail(email) → applicationId → professional + subscription.
 * @param {Object} req - Express request (must have req.user, req.tenantId, req.userId)
 * @returns {Promise<{ personalDetails: Object|null, professionalDetails: Object|null, subscriptionDetails: Object|null, personalDetailsSource: string, professionalDetailsSource: string, subscriptionDetailsSource: string }>}
 */
async function getAggregatedFromProfileService(req) {
  const tenantId = req.tenantId;
  const userId = extractUserId(req);
  const email = extractEmailFromToken(req);

  const result = {
    personalDetails: null,
    professionalDetails: null,
    subscriptionDetails: null,
    personalDetailsSource: SOURCE_PROFILE_SERVICE,
    professionalDetailsSource: SOURCE_PROFILE_SERVICE,
    subscriptionDetailsSource: SOURCE_PROFILE_SERVICE,
  };

  // 1) Portal-created users: lookup by userId first
  if (userId) {
    const [personalByUserId, professionalByUserId, subscriptionByUserId] =
      await Promise.all([
        personalDetailsService.getMyPersonalDetails(userId, tenantId),
        professionalDetailsService.getMyProfessionalDetails(userId, tenantId),
        subscriptionDetailsService.getMySubscriptionDetails(userId, tenantId),
      ]);

    if (personalByUserId) {
      result.personalDetails = personalByUserId;
      result.professionalDetails = professionalByUserId || null;
      result.subscriptionDetails = subscriptionByUserId || null;
      return result;
    }
  }

  // 2) CRM-created users: lookup by email (personalEmail or workEmail)
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
 * Fetch aggregated user details from portal-service by calling its three "my" endpoints.
 * Portal has GET /api/personal-details, GET /api/professional-details, GET /api/subscription-details.
 * @param {Object} req - Express request (userId, tenantId, auth headers)
 * @returns {Promise<{ personalDetails: Object|null, professionalDetails: Object|null, subscriptionDetails: Object|null, personalDetailsSource: string, professionalDetailsSource: string, subscriptionDetailsSource: string }|null>}
 *   Null if portal is not configured or all three calls fail / return no data.
 */
async function getAggregatedFromPortalService(req) {
  const portalBaseUrl = process.env.PORTAL_SERVICE_URL;
  if (!portalBaseUrl || !portalBaseUrl.trim()) {
    return null;
  }

  const tenantId = req.tenantId;
  const authHeader =
    req.headers?.authorization || req.headers?.Authorization;
  if (!authHeader || !tenantId) {
    return null;
  }

  const base = portalBaseUrl.replace(/\/$/, "");
  const headers = {
    Authorization: authHeader,
    "x-tenant-id": tenantId,
    "Content-Type": "application/json",
  };

  try {
    const axios = require("axios");

    const [personalRes, professionalRes, subscriptionRes] = await Promise.all([
      axios.get(`${base}/api/personal-details`, {
        headers,
        timeout: 10000,
        validateStatus: () => true,
      }),
      axios.get(`${base}/api/professional-details`, {
        headers,
        timeout: 10000,
        validateStatus: () => true,
      }),
      axios.get(`${base}/api/subscription-details`, {
        headers,
        timeout: 10000,
        validateStatus: () => true,
      }),
    ]);

    const getData = (res) => {
      if (res.status !== 200 || !res.data) return null;
      const d = res.data;
      if (d && typeof d.data !== "undefined") return d.data;
      return d;
    };

    const personalDetails = getData(personalRes);
    const professionalDetails = getData(professionalRes);
    const subscriptionDetails = getData(subscriptionRes);

    const hasAny =
      personalDetails != null ||
      professionalDetails != null ||
      subscriptionDetails != null;

    if (!hasAny) {
      return null;
    }

    return {
      personalDetails: personalDetails ?? null,
      professionalDetails: professionalDetails ?? null,
      subscriptionDetails: subscriptionDetails ?? null,
      personalDetailsSource: SOURCE_PORTAL_SERVICE,
      professionalDetailsSource: SOURCE_PORTAL_SERVICE,
      subscriptionDetailsSource: SOURCE_PORTAL_SERVICE,
    };
  } catch (err) {
    console.error(
      "[aggregated.user.details.service] Portal fetch error:",
      err.message
    );
    return null;
  }
}

/**
 * Normalize email for comparison (lowercase, trim).
 * @param {string} e - Email
 * @returns {string|null}
 */
function normalizeEmailForCompare(e) {
  if (typeof e !== "string" || !e.trim()) return null;
  return e.trim().toLowerCase();
}

/**
 * Resolve profileId for subscription-service lookup.
 * Tries: Profile by userId, personalDetails.profileId, Profile by normalizedEmail.
 * @param {Object} req - Express request
 * @param {Object} result - Aggregated result with personalDetails
 * @returns {Promise<string|null>} profileId or null
 */
async function resolveProfileId(req, result) {
  const tenantId = req.tenantId;
  const userId = extractUserId(req);
  const mongoose = require("mongoose");

  if (userId && mongoose.Types.ObjectId.isValid(userId)) {
    const profileByUserId = await Profile.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      tenantId,
    })
      .select("_id")
      .lean();
    if (profileByUserId?._id) return profileByUserId._id.toString();
  }

  const pd = result?.personalDetails;
  if (pd?.profileId) {
    return typeof pd.profileId === "string"
      ? pd.profileId
      : pd.profileId?.toString?.() ?? null;
  }

  const email =
    pd?.contactInfo?.personalEmail ||
    pd?.contactInfo?.workEmail ||
    extractEmailFromToken(req);
  const normalized = normalizeEmailForCompare(email);
  if (normalized && tenantId) {
    const profileByEmail = await Profile.findOne({
      normalizedEmail: normalized,
      tenantId,
    })
      .select("_id")
      .lean();
    if (profileByEmail?._id) return profileByEmail._id.toString();
  }

  return null;
}

/**
 * Enrich result.subscriptionDetails with subscription-service data.
 * Also propagates membershipCategory to professionalDetails when present.
 * @param {Object} result - Aggregated result
 * @param {Object} req - Express request
 */
async function enrichWithSubscriptionService(result, req) {
  if (!result) return;
  const profileId = await resolveProfileId(req, result);
  if (!profileId) return;

  const tenantId =
    result.personalDetails?.tenantId ?? req.tenantId;
  const sub = await fetchCurrentSubscriptionByProfileId(
    profileId,
    tenantId,
    req
  );
  if (sub) {
    result.subscriptionDetails = mergeSubscriptionServiceData(
      result.subscriptionDetails,
      sub
    );
    if (sub.membershipCategory && result.professionalDetails) {
      const pd = result.professionalDetails;
      if (pd.professionalDetails && typeof pd.professionalDetails === "object") {
        if (!pd.professionalDetails.membershipCategory) {
          pd.professionalDetails.membershipCategory = sub.membershipCategory;
        }
      } else if (typeof pd === "object") {
        if (!pd.membershipCategory) {
          pd.membershipCategory = sub.membershipCategory;
        }
      }
    }
  }
}

/**
 * Return true if the given email matches the personal details (personalEmail or workEmail).
 * @param {Object} personalDetails - Personal details document
 * @param {string} email - Email to match (normalized)
 * @returns {boolean}
 */
function personalDetailsMatchesEmail(personalDetails, email) {
  if (!personalDetails || !email) return false;
  const c = personalDetails.contactInfo || {};
  const p = normalizeEmailForCompare(c.personalEmail);
  const w = normalizeEmailForCompare(c.workEmail);
  return p === email || w === email;
}

/**
 * Get aggregated user details:
 * 1) First check portal service.
 * 2) If portal has data: check if profile service has the same (by email). If profile has it, return from profile; else return from portal.
 * 3) If portal has no data: return from profile (userId first for portal-created, then email for CRM-created).
 * @param {Object} req - Express request
 * @returns {Promise<Object>} { personalDetails, professionalDetails, subscriptionDetails, personalDetailsSource, professionalDetailsSource, subscriptionDetailsSource }
 */
async function getAggregatedUserDetails(req) {
  // 1) Check portal first
  const fromPortal = await getAggregatedFromPortalService(req);

  // 2) If portal has data: see if profile has the same (by email); prefer profile when same email exists there
  let finalResult;
  if (
    fromPortal &&
    (fromPortal.personalDetails ||
      fromPortal.professionalDetails ||
      fromPortal.subscriptionDetails)
  ) {
    const emailFromPortal =
      fromPortal.personalDetails?.contactInfo?.personalEmail ||
      fromPortal.personalDetails?.contactInfo?.workEmail ||
      extractEmailFromToken(req);
    const emailToUse = normalizeEmailForCompare(emailFromPortal);

    const fromProfile = await getAggregatedFromProfileService(req);

    // If profile has personal details for the same email, use profile (canonical source)
    if (
      emailToUse &&
      fromProfile.personalDetails &&
      personalDetailsMatchesEmail(fromProfile.personalDetails, emailToUse)
    ) {
      finalResult = fromProfile;
    } else {
      finalResult = fromPortal;
    }
  } else {
    // 3) Portal has no data: return from profile (portal-created by userId, or CRM-created by email)
    finalResult = await getAggregatedFromProfileService(req);
  }

  await enrichWithSubscriptionService(finalResult, req);
  return finalResult;
}

module.exports = {
  extractEmailFromToken,
  extractUserId,
  getPersonalDetailsByEmail,
  getProfessionalDetailsByApplicationId,
  getSubscriptionDetailsByApplicationId,
  getAggregatedFromProfileService,
  getAggregatedFromPortalService,
  getAggregatedUserDetails,
  enrichWithSubscriptionService,
  personalDetailsMatchesEmail,
  normalizeEmailForCompare,
  SOURCE_PROFILE_SERVICE,
  SOURCE_PORTAL_SERVICE,
};

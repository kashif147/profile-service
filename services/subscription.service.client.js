/**
 * Client to fetch subscription data from subscription-service.
 * Used to enrich profile responses with membershipCategory and other subscription attributes.
 */

const axios = require("axios");

const SUBSCRIPTION_SERVICE_URL =
  process.env.SUBSCRIPTION_SERVICE_URL ||
  "http://projectshell-vm.northeurope.cloudapp.azure.com/subscription-service";

/**
 * Build headers for subscription-service request (internal call).
 * @param {Object} req - Express request (optional)
 * @param {string} tenantId - Tenant ID
 * @returns {Object} Headers
 */
function buildHeaders(req, tenantId) {
  const headers = {
    "Content-Type": "application/json",
    "x-internal-request": "true",
    "x-tenant-id": tenantId || "",
  };
  if (req?.headers?.authorization) {
    headers.authorization = req.headers.authorization;
  }
  if (req?.headers?.["x-user-id"]) {
    headers["x-user-id"] = req.headers["x-user-id"];
  }
  if (req?.headers?.["x-user-email"]) {
    headers["x-user-email"] = req.headers["x-user-email"];
  }
  return headers;
}

/**
 * Fetch subscriptions for a profile from subscription-service.
 * @param {string} profileId - Profile ID (MongoDB ObjectId string)
 * @param {string} tenantId - Tenant ID
 * @param {Object} req - Express request (for auth/headers)
 * @returns {Promise<Object|null>} Current subscription or null
 */
async function fetchCurrentSubscriptionByProfileId(
  profileId,
  tenantId,
  req = null
) {
  if (!profileId) return null;

  const base = SUBSCRIPTION_SERVICE_URL.replace(/\/$/, "");
  const url = `${base}/api/v1/subscriptions/profile/${profileId}`;

  try {
    let response = await axios.get(url, {
      headers: buildHeaders(req, tenantId || ""),
      timeout: 8000,
      validateStatus: (status) => status < 500,
    });

    let raw = Array.isArray(response.data?.data) ? response.data.data : [];

    if (raw.length === 0 && tenantId) {
      const fallback = await axios.get(url, {
        headers: buildHeaders(req, ""),
        timeout: 8000,
        validateStatus: (status) => status < 500,
      });
      raw = Array.isArray(fallback.data?.data) ? fallback.data.data : [];
      if (raw.length > 0) {
        console.warn(
          `[subscription.service.client] Fallback succeeded for profile ${profileId} (tenantId filter omitted)`
        );
      }
    }

    const seen = new Set();
    const subscriptions = raw.filter((s) => {
      const id = s?._id?.toString?.() ?? JSON.stringify(s);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    if (subscriptions.length === 0) return null;

    // Pick exactly one: prefer isCurrent; else most recent by startDate, then createdAt
    const byRecency = [...subscriptions].sort((a, b) => {
      const aDate = a.startDate ? new Date(a.startDate).getTime() : 0;
      const bDate = b.startDate ? new Date(b.startDate).getTime() : 0;
      if (bDate !== aDate) return bDate - aDate;
      const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bCreated - aCreated;
    });

    const current =
      subscriptions.find((s) => s.isCurrent === true) || byRecency[0];

    return current;
  } catch (err) {
    console.warn(
      `[subscription.service.client] Failed to fetch for profile ${profileId}:`,
      err.message
    );
    return null;
  }
}

/**
 * Enrich subscriptionDetails with data from subscription-service.
 * Merges membershipCategory, paymentType, payrollNo, paymentFrequency, membershipMovement, etc.
 * @param {Object|null} subscriptionDetails - Existing subscription details from profile/portal
 * @param {Object|null} subServiceSubscription - Subscription from subscription-service
 * @returns {Object|null} Enriched subscription details
 */
function mergeSubscriptionServiceData(
  subscriptionDetails,
  subServiceSubscription
) {
  if (!subServiceSubscription) {
    return subscriptionDetails;
  }

  const subDetails =
    subscriptionDetails?.subscriptionDetails &&
    typeof subscriptionDetails.subscriptionDetails === "object"
      ? { ...subscriptionDetails.subscriptionDetails }
      : {};

  const enrichedSubDetails = {
    ...subDetails,
    membershipCategory:
      subServiceSubscription.membershipCategory ??
      subDetails.membershipCategory ??
      null,
    paymentType:
      subServiceSubscription.paymentType ?? subDetails.paymentType ?? null,
    payrollNo:
      subServiceSubscription.payrollNo ?? subDetails.payrollNo ?? null,
    paymentFrequency:
      subServiceSubscription.paymentFrequency ??
      subDetails.paymentFrequency ??
      null,
    membershipMovement:
      subServiceSubscription.membershipMovement ??
      subDetails.membershipMovement ??
      null,
  };

  const result =
    subscriptionDetails && typeof subscriptionDetails === "object"
      ? { ...subscriptionDetails }
      : { subscriptionDetails: {} };

  result.subscriptionDetails = enrichedSubDetails;
  result._subscriptionService = {
    startDate: subServiceSubscription.startDate ?? null,
    endDate: subServiceSubscription.endDate ?? null,
    subscriptionStatus: subServiceSubscription.subscriptionStatus ?? null,
    subscriptionYear: subServiceSubscription.subscriptionYear ?? null,
  };

  return result;
}

module.exports = {
  fetchCurrentSubscriptionByProfileId,
  mergeSubscriptionServiceData,
  SUBSCRIPTION_SERVICE_URL,
};

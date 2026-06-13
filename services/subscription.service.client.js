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
 * Parse subscription array from subscription-service response (handles multiple shapes).
 * @param {*} body - response.data from axios
 * @returns {Array} Array of subscription objects
 */
function parseSubscriptionsFromResponse(body) {
  if (!body || typeof body !== "object") return [];
  if (Array.isArray(body?.data?.data)) return body.data.data;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body)) return body;
  return [];
}

/**
 * Fetch subscriptions for a profile from subscription-service.
 * When currentSubscriptionId is provided, picks that subscription by _id; otherwise picks isCurrent or most recent.
 * @param {string} profileId - Profile ID (MongoDB ObjectId string)
 * @param {string} tenantId - Tenant ID
 * @param {Object} req - Express request (for auth/headers)
 * @param {string|null} [currentSubscriptionId] - Optional subscription _id from Profile.currentSubscriptionId
 * @returns {Promise<Object|null>} Current subscription or null
 */
async function fetchCurrentSubscriptionByProfileId(
  profileId,
  tenantId,
  req = null,
  currentSubscriptionId = null,
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

    let raw = parseSubscriptionsFromResponse(response.data);

    if (raw.length === 0 && tenantId) {
      const fallback = await axios.get(url, {
        headers: buildHeaders(req, ""),
        timeout: 8000,
        validateStatus: (status) => status < 500,
      });
      raw = parseSubscriptionsFromResponse(fallback.data);
      if (raw.length > 0) {
        console.warn(
          `[subscription.service.client] Fallback succeeded for profile ${profileId} (tenantId filter omitted)`,
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

    const currentSubIdStr =
      currentSubscriptionId != null
        ? String(currentSubscriptionId).trim()
        : null;

    if (currentSubIdStr) {
      const byId = subscriptions.find(
        (s) => (s?._id?.toString?.() ?? "") === currentSubIdStr,
      );
      if (byId) return byId;
    }

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
      err.message,
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
  subServiceSubscription,
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
    payrollNo: subServiceSubscription.payrollNo ?? subDetails.payrollNo ?? null,
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

async function reassignSubscriptionsForProfileMerge({
  tenantId,
  masterProfileId,
  absorbedProfileId,
  masterMembershipNumber = null,
  absorbedMembershipNumber = null,
  req = null,
}) {
  const base = SUBSCRIPTION_SERVICE_URL.replace(/\/$/, "");
  const url = `${base}/api/v1/subscriptions/internal/profile-merge`;

  const response = await axios.post(
    url,
    {
      masterProfileId,
      absorbedProfileId,
      masterMembershipNumber,
      absorbedMembershipNumber,
    },
    {
      headers: buildHeaders(req, tenantId || ""),
      timeout: 30000,
      validateStatus: (status) => status < 500,
    },
  );

  if (response.status >= 400) {
    const message =
      response.data?.error?.message ||
      response.data?.message ||
      `Subscription merge failed (${response.status})`;
    throw new Error(message);
  }

  return response.data?.data || response.data || {};
}

module.exports = {
  fetchCurrentSubscriptionByProfileId,
  mergeSubscriptionServiceData,
  reassignSubscriptionsForProfileMerge,
  SUBSCRIPTION_SERVICE_URL,
};

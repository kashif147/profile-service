/**
 * Client to fetch subscription data from subscription-service.
 * Used to enrich profile responses with membershipCategory and other subscription attributes.
 */

const axios = require("axios");

// No hard-coded fallback host: an unset SUBSCRIPTION_SERVICE_URL must never send the internal header
// and the trusted tenant to a public address. Missing configuration fails closed (503) before any request.
const SUBSCRIPTION_SERVICE_URL = (process.env.SUBSCRIPTION_SERVICE_URL || "").trim();

function subscriptionServiceBase() {
  const configured = (process.env.SUBSCRIPTION_SERVICE_URL || "").trim();
  if (!configured) {
    const err = new Error("SUBSCRIPTION_SERVICE_URL is not configured");
    err.status = 503;
    err.statusCode = 503;
    err.code = "SUBSCRIPTION_SERVICE_URL_REQUIRED";
    throw err;
  }
  return configured.replace(/\/$/, "");
}

/**
 * Headers for a subscription-service call: a genuine internal call (x-internal-request + the
 * trusted tenant) and NEVER the caller's identity.
 *
 * P5 (subscription #30 prerequisite): every caller of this client has already authorized the
 * business action in profile-service (route-level requireCrm / crmOrOwnProfile* / portal own-profile
 * resolution, or an internal path) and passes a profileId it resolved server-side. Forwarding the
 * user's Authorization / x-user-* alongside x-internal-request made subscription-service treat a
 * user request as internal; once internal stops accepting a forwarded identity, such a mixed
 * request would be evaluated as the user instead (non-ASU CRM is denied subscriptions:read by the
 * PDP category rule; /internal/profile-merge refuses users), breaking enrichment and merges.
 * @param {string} tenantId - Trusted tenant ID
 * @returns {Object} Headers
 */
function buildHeaders(tenantId) {
  return {
    "Content-Type": "application/json",
    "x-internal-request": "true",
    "x-tenant-id": tenantId,
  };
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
 * @param {Object} req - Unused (kept for call compatibility; the caller identity is never forwarded)
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
  // Phase A / A3: subscriptions are tenant-owned. Never call subscription-service without the
  // caller's trusted tenant, and never retry with an empty tenant (that unscoped retry returned
  // other tenants' subscriptions for the same profileId).
  const trustedTenant = tenantId == null ? "" : String(tenantId).trim();
  if (!trustedTenant) return null;

  const base = subscriptionServiceBase();
  const url = `${base}/api/v1/subscriptions/profile/${profileId}`;

  try {
    const response = await axios.get(url, {
      headers: buildHeaders(trustedTenant),
      timeout: 8000,
      validateStatus: (status) => status < 500,
    });

    const raw = parseSubscriptionsFromResponse(response.data);

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
  // Internal-only route: never call it without the trusted tenant.
  const trustedTenant = tenantId == null ? "" : String(tenantId).trim();
  if (!trustedTenant) throw new Error("Subscription merge requires a trusted tenant");

  const base = subscriptionServiceBase();
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
      headers: buildHeaders(trustedTenant),
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
  buildHeaders,
  fetchCurrentSubscriptionByProfileId,
  mergeSubscriptionServiceData,
  reassignSubscriptionsForProfileMerge,
  SUBSCRIPTION_SERVICE_URL,
  subscriptionServiceBase,
};

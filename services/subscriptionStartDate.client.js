"use strict";
/**
 * Current-subscription startDate lookup for the CRM batch and legacy corn-market exports.
 *
 * P5 (subscription #30/#31 prerequisite): this is a genuine service call made AFTER the route has
 * authorized the business action (CRM + profile:read / profile:write, see routes/batch.routes.js and
 * routes/corn.market.routes.js) on profile ids this service resolved itself from its own tenant-scoped
 * query. It therefore sends internal-only headers (x-internal-request + the trusted tenant) and NEVER
 * the caller's Authorization / x-user-* identity.
 *
 * No hard-coded fallback host: if SUBSCRIPTION_SERVICE_URL is not configured the lookup fails closed
 * (503) instead of sending tenant context to an unintended external host.
 */
const axios = require("axios");
const { AppError } = require("../errors/AppError");

function subscriptionServiceBase() {
  const raw = process.env.SUBSCRIPTION_SERVICE_URL;
  const base = typeof raw === "string" ? raw.trim().replace(/\/$/, "") : "";
  if (!base) {
    throw new AppError(
      "Subscription service is not configured",
      503,
      "SUBSCRIPTION_SERVICE_URL_REQUIRED",
    );
  }
  return base;
}

function internalHeaders(tenantId) {
  return {
    "x-internal-request": "true",
    "x-tenant-id": tenantId,
  };
}

/**
 * @param {Array<string|import("mongoose").Types.ObjectId>} profileIds - ids resolved server-side
 * @param {string} tenantId - the verified caller's tenant (req.tenantId)
 * @returns {Promise<Map<string, string>>} profileId -> startDate (profiles without one are omitted)
 */
async function fetchSubscriptionStartDates(profileIds, tenantId) {
  const map = new Map();
  if (!Array.isArray(profileIds) || profileIds.length === 0) return map;
  const tenant = tenantId == null ? "" : String(tenantId).trim();
  if (!tenant) throw AppError.forbidden("Tenant context is required");
  const base = subscriptionServiceBase();

  const results = await Promise.all(
    profileIds.map(async (id) => {
      const profileId = String(id);
      try {
        const response = await axios.get(
          `${base}/api/v1/subscriptions/profile/${encodeURIComponent(profileId)}/current`,
          {
            timeout: 10000,
            validateStatus: (status) => status < 500,
            headers: internalHeaders(tenant),
          },
        );
        if (response.status === 200 && response.data?.data?.startDate) {
          return [profileId, response.data.data.startDate];
        }
        return null;
      } catch (error) {
        // A single profile's lookup failing leaves its startDate empty (existing behaviour);
        // only the missing configuration above fails the whole request.
        console.warn(`Failed to fetch subscription for profile ${profileId}:`, error.message);
        return null;
      }
    }),
  );
  for (const r of results) if (r) map.set(r[0], r[1]);
  return map;
}

module.exports = { fetchSubscriptionStartDates, internalHeaders, subscriptionServiceBase };

const axios = require("axios");

/*
 * Organisation timezone (user-service Tenant.regionalSettings.timezone) for date-bucketed
 * figures such as a drive's "today". Read through user-service's existing internal
 * GET /api/internal/tenants/:tenantId/lifecycle-config (the same endpoint
 * subscription-service's tenantLifecycleClient uses): staff calling the drive APIs hold no
 * tenant:read permission, and this is a system config read, not an action on the user's
 * behalf. tenantId is always the trusted request tenant.
 *
 * Never throws: a missing, invalid or unreachable value falls back to Europe/Dublin.
 */

const FALLBACK_TIMEZONE = "Europe/Dublin";
const CACHE_TTL_MS = 10 * 60 * 1000;
// Fallbacks caused by an unreachable user-service are retried sooner.
const FALLBACK_CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL || process.env.POLICY_SERVICE_URL || "http://localhost:3000";

function isValidTimeZone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

async function getTenantTimezone(tenantId, { now = Date.now() } = {}) {
  if (!tenantId) return FALLBACK_TIMEZONE;
  const key = String(tenantId);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.timezone;

  let timezone = FALLBACK_TIMEZONE;
  let authoritative = false;
  try {
    const base = USER_SERVICE_URL.replace(/\/$/, "");
    const response = await axios.get(
      `${base}/api/internal/tenants/${encodeURIComponent(key)}/lifecycle-config`,
      {
        headers: { "x-internal-request": "true", "x-tenant-id": key },
        timeout: 5000,
        validateStatus: (s) => s < 500,
      },
    );
    const configured = response.data?.data?.regionalSettings?.timezone;
    if (response.status >= 200 && response.status < 300 && isValidTimeZone(configured)) {
      timezone = configured;
      authoritative = true;
    } else if (response.status >= 200 && response.status < 300) {
      authoritative = true; // tenant has no valid timezone configured: fallback is the answer
    } else if (response.status >= 300) {
      console.warn("[tenantTimezone] lifecycle-config non-success", { tenantId: key, status: response.status });
    }
  } catch (error) {
    console.warn("[tenantTimezone] lifecycle-config fetch failed", { tenantId: key, code: error.code || null });
  }

  cache.set(key, {
    timezone,
    expiresAt: now + (authoritative ? CACHE_TTL_MS : FALLBACK_CACHE_TTL_MS),
  });
  return timezone;
}

function clearCache() {
  cache.clear();
}

module.exports = { getTenantTimezone, isValidTimeZone, clearCache, FALLBACK_TIMEZONE };

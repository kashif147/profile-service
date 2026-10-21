const axios = require("axios");

/*
 * Organisation timezone (user-service Tenant.regionalSettings.timezone) for date-bucketed
 * figures such as a drive's "today" and attribution window.
 *
 * Read AS THE CALLER: the inbound Authorization (and tenant/user/correlation ids) is forwarded
 * to user-service's GET /api/tenant/regional-settings, which resolves the tenant from the
 * verified identity and is gated by the least-privilege "tenant-regional-settings:read"
 * permission. No x-internal-request header and no tenant id in the path - the caller can only
 * ever read their own tenant's settings.
 *
 * That endpoint is a pending user-service change (see docs/MEMBERSHIP_DRIVES_API.md). Until it
 * exists, or whenever the caller lacks the permission or user-service is unreachable, this
 * resolves to Europe/Dublin. It never throws.
 *
 * Successful answers are cached per tenant (tenant configuration, not user data). An
 * unavailable endpoint is cached briefly; a caller-specific 401/403 is never cached.
 */

const FALLBACK_TIMEZONE = "Europe/Dublin";
const CACHE_TTL_MS = 10 * 60 * 1000;
// Endpoint missing (404) or user-service unavailable: retry after a minute rather than on every
// request. 401/403 are about the caller, not the tenant, so they are never cached.
const UNAVAILABLE_TTL_MS = 60 * 1000;
const REGIONAL_SETTINGS_PATH = "/api/tenant/regional-settings";
const cache = new Map();

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL || process.env.POLICY_SERVICE_URL || "http://localhost:3000";

const FORWARDED_HEADERS = ["authorization", "x-user-id", "x-correlation-id"];

function isValidTimeZone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function callerHeaders(req, tenantId) {
  const headers = { "x-tenant-id": String(tenantId) };
  for (const name of FORWARDED_HEADERS) {
    if (req?.headers?.[name]) headers[name] = req.headers[name];
  }
  return headers;
}

/**
 * @param {string} tenantId trusted request tenant
 * @param {object} req inbound request whose caller identity is forwarded
 */
async function getTenantTimezone(tenantId, req, { now = Date.now() } = {}) {
  if (!tenantId) return FALLBACK_TIMEZONE;
  const key = String(tenantId);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.timezone;

  if (!req?.headers?.authorization) return FALLBACK_TIMEZONE;

  try {
    const base = USER_SERVICE_URL.replace(/\/$/, "");
    const response = await axios.get(`${base}${REGIONAL_SETTINGS_PATH}`, {
      headers: callerHeaders(req, key),
      timeout: 5000,
      validateStatus: (s) => s < 500,
    });
    const body = response.data?.data || {};
    // Only trust an answer about the tenant we asked for.
    const sameTenant = body.tenantId == null || String(body.tenantId) === key;
    if (response.status >= 200 && response.status < 300 && sameTenant && isValidTimeZone(body.timezone)) {
      cache.set(key, { timezone: body.timezone, expiresAt: now + CACHE_TTL_MS });
      return body.timezone;
    }
    if (response.status >= 300) {
      console.warn("[tenantTimezone] regional-settings non-success", { tenantId: key, status: response.status });
    }
    if (response.status === 404) {
      cache.set(key, { timezone: FALLBACK_TIMEZONE, expiresAt: now + UNAVAILABLE_TTL_MS });
    }
  } catch (error) {
    console.warn("[tenantTimezone] regional-settings fetch failed", { tenantId: key, code: error.code || null });
    cache.set(key, { timezone: FALLBACK_TIMEZONE, expiresAt: now + UNAVAILABLE_TTL_MS });
  }
  return FALLBACK_TIMEZONE;
}

function clearCache() {
  cache.clear();
}

module.exports = { getTenantTimezone, isValidTimeZone, clearCache, FALLBACK_TIMEZONE };

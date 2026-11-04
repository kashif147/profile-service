const axios = require("axios");

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL ||
  process.env.POLICY_SERVICE_URL ||
  "http://localhost:3000";

async function fetchTenantContext(tenantId, req = null) {
  if (!tenantId) return { branding: {}, organisationProfile: {} };
  const base = USER_SERVICE_URL.replace(/\/$/, "");
  const headers = {
    "Content-Type": "application/json",
    "x-tenant-id": String(tenantId),
    "x-internal-request": "true",
  };
  if (req?.headers?.authorization) {
    headers.authorization = req.headers.authorization;
  }
  if (req?.headers?.["x-user-id"]) {
    headers["x-user-id"] = req.headers["x-user-id"];
  }
  try {
    const response = await axios.get(`${base}/api/tenants/${tenantId}`, {
      headers,
      timeout: 8000,
      validateStatus: (s) => s < 500,
    });
    if (response.status < 200 || response.status >= 300) {
      console.warn(
        "[tenant.service.client] tenant fetch non-success:",
        response.status,
        response.data?.error?.message || response.statusText
      );
      return { branding: {}, organisationProfile: {}, tenantName: "" };
    }
    const tenant = response.data?.data || response.data || {};
    return {
      branding: tenant.branding || {},
      organisationProfile: tenant.organisationProfile || {},
      tenantName: tenant.name || tenant.code || "",
    };
  } catch (err) {
    console.warn("[tenant.service.client] fetch failed:", err.message);
    return { branding: {}, organisationProfile: {}, tenantName: "" };
  }
}

/**
 * PDP P3 (O6 / finding N3): the organisation's creditor / beneficiary details for payment-form hydration, from
 * user-service's internal-only GET /internal/tenants/:tenantId/creditor-profile (not gateway-proxied), as a
 * genuine service call: x-service-secret = INTERNAL_TENANT_PROFILE_SECRET, x-tenant-id = the tenant of the
 * verified caller; no user token is forwarded. The user-facing GET /api/tenants/:id is redacted per caller
 * (bank fields need payments.bank:read), and the forwarded-token fetch used to turn every non-ASU 403 into {}
 * -> forms persisted a blank creditor snapshot.
 *
 * Fail closed: when the secret is configured, any failure throws 503 (no blank snapshot is ever stored).
 * Rollout: while the secret is not configured in this service, the previous forwarded-token fetch is used
 * unchanged (fetchTenantContext) and a warning is logged.
 */
async function fetchCreditorContext(tenantId, req = null) {
  const secret = process.env.INTERNAL_TENANT_PROFILE_SECRET;
  if (typeof secret !== "string" || secret.length < 32) {
    console.warn("[tenant.service.client] INTERNAL_TENANT_PROFILE_SECRET not configured; creditor details via the caller's token (legacy)");
    return fetchTenantContext(tenantId, req);
  }
  const { AppError } = require("../errors/AppError.js");
  const unavailable = () =>
    new AppError("Organisation creditor details are unavailable", 503, "CREDITOR_PROFILE_UNAVAILABLE");
  if (!tenantId) throw unavailable();
  const base = USER_SERVICE_URL.replace(/\/$/, "");
  let response;
  try {
    response = await axios.get(`${base}/internal/tenants/${encodeURIComponent(String(tenantId))}/creditor-profile`, {
      headers: {
        "x-service-secret": secret,
        "x-tenant-id": String(tenantId),
        "x-internal-request": "true",
        "x-service-name": "profile-service",
      },
      timeout: 8000,
      validateStatus: () => true,
    });
  } catch (err) {
    console.warn("[tenant.service.client] creditor profile fetch failed:", err.message);
    throw unavailable();
  }
  const data = response && response.status === 200 ? response.data && response.data.data : null;
  if (!data || typeof data !== "object") {
    console.warn("[tenant.service.client] creditor profile non-success:", response && response.status);
    throw unavailable();
  }
  return {
    branding: data.branding || {},
    organisationProfile: data.organisationProfile || {},
    tenantName: data.name || data.code || "",
  };
}

function formatBankAddress(bankAddress = {}) {
  const lines = [
    [bankAddress.buildingOrHouse, bankAddress.streetOrRoad]
      .filter(Boolean)
      .join(", "),
    [bankAddress.areaOrTown, bankAddress.countyCityOrPostCode]
      .filter(Boolean)
      .join(", "),
    bankAddress.eircode,
    bankAddress.country || "Ireland",
  ].filter(Boolean);
  return lines.join("\n");
}

function formatOrgAddress(org = {}) {
  const bankLines = formatBankAddress(org.bankAddress || {});
  if (bankLines) return bankLines;
  const a = org.address || {};
  const lines = [
    [a.street, a.city].filter(Boolean).join(", "),
    [a.state, a.zipCode].filter(Boolean).join(", "),
    a.country,
  ].filter(Boolean);
  return lines.join("\n");
}

function resolveTenantTradingName(organisationProfile = {}, tenant = {}) {
  return String(
    organisationProfile.tradingName ||
      organisationProfile.legalName ||
      tenant.name ||
      tenant.tenantName ||
      tenant.code ||
      "",
  ).trim();
}

module.exports = {
  fetchTenantContext,
  fetchCreditorContext,
  formatOrgAddress,
  formatBankAddress,
  resolveTenantTradingName,
};

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
 * user-service's internal-only GET /internal/tenants/:tenantId/creditor-profile (not gateway-proxied) as a SIGNED
 * service read (p5-svc-sig/1, services/userServiceSigning.js: caller profile-service, audience user-service,
 * signature over GET + exact path + x-tenant-id). No user token and no other identity header is sent (user-service
 * answers 404 to any request carrying one). x-tenant-id is the tenant of the verified caller of this request.
 *
 * Fail closed - every failure throws 503 CREDITOR_PROFILE_UNAVAILABLE (no blank snapshot is ever stored):
 * signing not configured, misconfigured (503 USER_SIGNING_MISCONFIGURED), verifier off / not configured,
 * rejected signature, network error, non-200.
 *
 * PAYMENT_FORM_CREDITOR_LEGACY_FETCH=on (default OFF) is an explicit, temporary rollback switch only: while signing
 * is NOT configured it falls back to the previous forwarded-token GET /api/tenants/:id (fetchTenantContext), whose
 * bank fields are now redacted unless the caller holds payments.bank:read / tenant:update / "*" - i.e. it restores
 * exactly today's behaviour, including the blank-snapshot defect for other callers. It exists so a profile-service
 * rollback / an out-of-order deploy can keep ASU form creation working without re-introducing a shared secret; it
 * never applies once signing keys are configured.
 */
function legacyFetchEnabled(env = process.env) {
  return String(env.PAYMENT_FORM_CREDITOR_LEGACY_FETCH || "").trim().toLowerCase() === "on";
}

async function fetchCreditorContext(tenantId, req = null, { env = process.env } = {}) {
  const { AppError } = require("../errors/AppError.js");
  const { signedGetHeaders } = require("./userServiceSigning.js");
  const unavailable = () =>
    new AppError("Organisation creditor details are unavailable", 503, "CREDITOR_PROFILE_UNAVAILABLE");
  if (!tenantId) throw unavailable();
  const base = USER_SERVICE_URL.replace(/\/$/, "");
  const url = `${base}/internal/tenants/${encodeURIComponent(String(tenantId))}/creditor-profile`;
  const signed = signedGetHeaders({ url, tenant: String(tenantId), env });
  if (!signed) {
    if (legacyFetchEnabled(env)) {
      console.warn("[tenant.service.client] creditor profile: signing not configured; PAYMENT_FORM_CREDITOR_LEGACY_FETCH=on (legacy forwarded-token fetch)");
      return fetchTenantContext(tenantId, req);
    }
    console.error("[tenant.service.client] creditor profile: user-service signing not configured (USER_SIGNING_KID / USER_SIGNING_SECRET)");
    throw unavailable();
  }
  let response;
  try {
    response = await axios.get(url, {
      headers: { "x-tenant-id": String(tenantId), ...signed },
      timeout: 8000,
      validateStatus: () => true,
    });
  } catch (err) {
    console.warn("[tenant.service.client] creditor profile fetch failed:", err.message);
    throw unavailable();
  }
  const data = response && response.status === 200 ? response.data && response.data.data : null;
  if (!data || typeof data !== "object" || String(data.tenantId) !== String(tenantId)) {
    console.warn("[tenant.service.client] creditor profile non-success:", response && response.status, response && response.data && response.data.code);
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

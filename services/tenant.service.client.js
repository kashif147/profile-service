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

module.exports = { fetchTenantContext, formatOrgAddress, formatBankAddress };

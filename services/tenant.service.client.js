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
  try {
    const response = await axios.get(`${base}/tenants/${tenantId}`, {
      headers,
      timeout: 8000,
      validateStatus: (s) => s < 500,
    });
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

function formatOrgAddress(org = {}) {
  const a = org.bankAddress || org.address || {};
  const lines = [
    org.legalName || org.tradingName,
    [a.buildingOrHouse, a.streetOrRoad].filter(Boolean).join(", "),
    [a.areaOrTown, a.countyCityOrPostCode].filter(Boolean).join(", "),
    a.eircode,
    a.country || "Ireland",
  ].filter(Boolean);
  return lines.join("\n");
}

module.exports = { fetchTenantContext, formatOrgAddress };

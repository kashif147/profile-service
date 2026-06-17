/**
 * Client to fetch member finance data from account-service.
 * Auth: forward JWT/token headers from the inbound request (no API keys).
 */

const axios = require("axios");

const ACCOUNT_SERVICE_URL =
  process.env.ACCOUNT_SERVICE_URL ||
  "http://projectshell-vm.northeurope.cloudapp.azure.com/account-service";

function getMemberIdLookupKeys(memberId) {
  const raw = memberId != null ? String(memberId).trim() : "";
  if (!raw) return [];
  const noSpaces = raw.replace(/\s+/g, "");
  const upper = noSpaces.toUpperCase();
  const alnumOnly = upper.replace(/[^A-Z0-9]/g, "");
  return [...new Set([raw, noSpaces, upper, alnumOnly].filter(Boolean))];
}

function buildHeaders(req, tenantId) {
  const headers = {
    "Content-Type": "application/json",
    "x-tenant-id": tenantId || req?.headers?.["x-tenant-id"] || "",
    "x-internal-request": "true",
  };

  if (req?.headers?.authorization) {
    headers.authorization = req.headers.authorization;
  }
  if (req?.headers?.["x-jwt-verified"]) {
    headers["x-jwt-verified"] = req.headers["x-jwt-verified"];
  }
  if (req?.headers?.["x-auth-source"]) {
    headers["x-auth-source"] = req.headers["x-auth-source"];
  }
  if (req?.headers?.["x-user-id"]) {
    headers["x-user-id"] = req.headers["x-user-id"];
  }
  if (req?.headers?.["x-user-email"]) {
    headers["x-user-email"] = req.headers["x-user-email"];
  }
  if (req?.headers?.["x-user-roles"]) {
    headers["x-user-roles"] = req.headers["x-user-roles"];
  }
  if (req?.headers?.["x-user-permissions"]) {
    headers["x-user-permissions"] = req.headers["x-user-permissions"];
  }

  const correlationId =
    req?.correlationId || req?.headers?.["x-correlation-id"];
  if (correlationId) {
    headers["x-correlation-id"] = String(correlationId);
  }

  return headers;
}

/**
 * Fetch finance summary for a member (membership number) from account-service.
 * @param {string} membershipNumber
 * @param {string} tenantId
 * @param {object|null} req - Express request for JWT forwarding
 * @returns {Promise<object|null>}
 */
async function fetchMemberFinanceSummary(membershipNumber, tenantId, req = null) {
  const lookupKeys = getMemberIdLookupKeys(membershipNumber);
  if (!lookupKeys.length) return null;

  const base = ACCOUNT_SERVICE_URL.replace(/\/$/, "");
  const url = `${base}/api/reports/members/summary-batch`;

  try {
    const response = await axios.post(
      url,
      { memberIds: lookupKeys, scope: "all" },
      {
        headers: buildHeaders(req, tenantId || ""),
        timeout: 15000,
        validateStatus: (status) => status < 500,
      },
    );

    const items = response.data?.data?.items || [];
    if (!items.length) return null;

    for (const key of lookupKeys) {
      const match = items.find(
        (row) => String(row?.memberId || "").trim() === key,
      );
      if (match) return match;
    }

    return items[0] || null;
  } catch (err) {
    console.warn(
      `[account.service.client] Failed to fetch finance summary for ${membershipNumber}:`,
      err.message,
    );
    return null;
  }
}

async function reassignFinanceForProfileMerge({
  tenantId,
  masterProfileId,
  absorbedProfileId,
  masterMembershipNumber,
  absorbedMembershipNumber,
  req = null,
}) {
  const base = ACCOUNT_SERVICE_URL.replace(/\/$/, "");
  const url = `${base}/api/finance/internal/profile-merge`;

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
      `Finance merge reassignment failed (${response.status})`;
    throw new Error(message);
  }

  return response.data?.data || response.data || {};
}

function normalizePaymentStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "requires_capture") return "Authorised";
  if (value === "succeeded") return "Captured";
  if (value === "canceled" || value === "cancelled") return "Cancelled";
  if (value === "authorization_expired") return "Authorisation Expired";
  if (value === "payment_required" || value === "requires_payment_method") {
    return "Payment Required";
  }
  if (value === "refund_required") return "Refund Required";
  if (value === "manual_review") return "Manual Review";
  return status || null;
}

async function callPaymentIntentAction({
  paymentIntentId,
  action,
  tenantId,
  req = null,
}) {
  const intentId = String(paymentIntentId || "").trim();
  if (!intentId) {
    throw new Error("PaymentIntent ID is required");
  }

  const base = ACCOUNT_SERVICE_URL.replace(/\/$/, "");
  const url = `${base}/api/payments/intents/${encodeURIComponent(
    intentId,
  )}/${action}`;
  const idempotencySource =
    req?.headers?.["idempotency-key"] ||
    req?.headers?.["x-idempotency-key"] ||
    `${action}-${intentId}`;
  const idempotencyKey = String(
    idempotencySource === `${action}-${intentId}`
      ? idempotencySource
      : `${idempotencySource}-${action}-${intentId}`,
  ).slice(0, 128);

  const response = await axios.post(
    url,
    {},
    {
      headers: {
        ...buildHeaders(req, tenantId || ""),
        "Idempotency-Key": idempotencyKey,
      },
      timeout: 30000,
      validateStatus: (status) => status < 500,
    },
  );

  if (response.status >= 400) {
    const message =
      response.data?.error?.message ||
      response.data?.message ||
      `Payment ${action} failed (${response.status})`;
    const error = new Error(message);
    error.statusCode = response.status;
    error.responseData = response.data;
    throw error;
  }

  const data = response.data?.data || response.data || {};
  if (data.status) {
    data.displayStatus = normalizePaymentStatus(data.status);
  }
  return data;
}

async function fetchLatestApplicationPayment(applicationId, tenantId, req = null) {
  const appId = String(applicationId || "").trim();
  if (!appId) return null;

  const base = ACCOUNT_SERVICE_URL.replace(/\/$/, "");
  const url = `${base}/api/payments/applications/${encodeURIComponent(
    appId,
  )}/latest`;

  const response = await axios.get(url, {
    headers: buildHeaders(req, tenantId || ""),
    timeout: 15000,
    validateStatus: (status) => status < 500,
  });

  if (response.status === 404) return null;
  if (response.status >= 400) {
    const message =
      response.data?.error?.message ||
      response.data?.message ||
      `Latest application payment lookup failed (${response.status})`;
    throw new Error(message);
  }

  return response.data?.data || response.data || null;
}

async function capturePaymentIntent(paymentIntentId, tenantId, req = null) {
  return callPaymentIntentAction({
    paymentIntentId,
    action: "capture",
    tenantId,
    req,
  });
}

async function cancelPaymentIntent(paymentIntentId, tenantId, req = null) {
  return callPaymentIntentAction({
    paymentIntentId,
    action: "cancel",
    tenantId,
    req,
  });
}

module.exports = {
  fetchMemberFinanceSummary,
  getMemberIdLookupKeys,
  buildHeaders,
  reassignFinanceForProfileMerge,
  fetchLatestApplicationPayment,
  capturePaymentIntent,
  cancelPaymentIntent,
  normalizePaymentStatus,
  ACCOUNT_SERVICE_URL,
};

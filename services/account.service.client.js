/**
 * Client to fetch member finance data from account-service.
 * Auth: forward JWT/token headers from the inbound request (no API keys).
 */

const axios = require("axios");
const { AppError } = require("../errors/AppError");
const { signatureHeaders } = require("./accountCommandSigning");

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

/**
 * P5 bound payment commands (S2). `ACCOUNT_PAYMENT_COMMAND_MODE=bound` switches application
 * capture/cancel to the bound internal command (b5 payment-mutation contract section 3):
 * internal-only headers (no authorization / x-jwt-verified / x-auth-source / x-user-*), a body that
 * names the business object and transition, actorUserId as audit metadata only, and a
 * deterministic Idempotency-Key. Default `legacy` sends exactly today's request, so this service
 * can deploy before account-service understands the command (contract 8.3: account S1 first,
 * then flip the mode).
 */
const TENANT_ID_RE = /^[a-f0-9]{24}$/i;

/**
 * Canonical Idempotency-Key (contracts/p5-bound-payment-commands.v1.json):
 * <domain>:<transition>:<objectId>:<paymentRef>; for application capture/cancel the paymentRef
 * is the PaymentIntent id in the route, so the key never depends on a payment lookup.
 */
function boundIdempotencyKey(action, applicationId, paymentIntentId) {
  return ["application", action, applicationId, paymentIntentId].join(":");
}

function paymentCommandMode() {
  return String(process.env.ACCOUNT_PAYMENT_COMMAND_MODE || "legacy").trim().toLowerCase() === "bound"
    ? "bound"
    : "legacy";
}

function commandError(message, status, code) {
  const error = new AppError(message, status, code);
  error.statusCode = status;
  return error;
}

/** The bound command must stay inside the service network: a gateway URL strips x-internal-request. */
function assertInternalAccountUrl() {
  const raw = process.env.ACCOUNT_SERVICE_URL;
  let host = null;
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") host = u.hostname;
  } catch {
    host = null;
  }
  const internal = host && (!host.includes(".") || host === "127.0.0.1");
  if (!internal) {
    throw commandError(
      "Account service is not configured for internal payment commands.",
      503,
      "ACCOUNT_INTERNAL_URL_REQUIRED",
    );
  }
}

function buildInternalCommandHeaders(tenantId, req) {
  const tenant = tenantId ? String(tenantId) : "";
  if (!TENANT_ID_RE.test(tenant)) {
    throw commandError("A verified tenant is required for a payment command.", 400, "TENANT_REQUIRED");
  }
  const headers = {
    "Content-Type": "application/json",
    "x-internal-request": "true",
    "x-tenant-id": tenant,
  };
  const correlationId = req?.correlationId || req?.headers?.["x-correlation-id"];
  if (correlationId) headers["x-correlation-id"] = String(correlationId);
  return headers;
}

/** Bound-mode response -> the `status` shape the call sites already read. */
function normalizeCommandResult(action, data) {
  const out = { ...(data || {}) };
  if (!out.status) {
    if (action === "capture" && (out.captured || out.alreadyCaptured)) out.status = "succeeded";
    if (action === "cancel" && (out.canceled || out.alreadyCanceled)) out.status = "canceled";
  }
  return out;
}

const APPLICATION_REASONS = { capture: "approve", cancel: "reject" };

async function callBoundPaymentIntentAction({ intentId, action, tenantId, req, command }) {
  const applicationId = command?.applicationId ? String(command.applicationId) : "";
  const actorUserId = command?.actorUserId ? String(command.actorUserId) : "";
  if (!applicationId) throw commandError("applicationId is required for a payment command.", 400, "PAYMENT_BINDING_REQUIRED");
  if (!actorUserId) throw commandError("A verified actor is required for a payment command.", 400, "ACTOR_REQUIRED");
  assertInternalAccountUrl();
  const headers = buildInternalCommandHeaders(tenantId, req);
  const paymentId = command?.paymentId ? String(command.paymentId) : null;
  headers["Idempotency-Key"] = boundIdempotencyKey(action, applicationId, intentId);

  const body = {
    binding: {
      domain: "application",
      applicationId,
      purpose: "applicationFee",
      ...(paymentId ? { paymentId } : {}),
    },
    transition: action,
    reason: APPLICATION_REASONS[action],
    actorUserId,
  };

  const base = process.env.ACCOUNT_SERVICE_URL.replace(/\/$/, "");
  const url = `${base}/api/payments/intents/${encodeURIComponent(intentId)}/${action}`;
  // P5 S3: sign the exact bytes that go on the wire (transformRequest sends `raw` unchanged) when
  // this service's own signing credential is configured; a retry signs again with a fresh nonce.
  const raw = JSON.stringify(body);
  Object.assign(headers, signatureHeaders({ method: "POST", url, tenant: headers["x-tenant-id"], idem: headers["Idempotency-Key"], raw }));
  let response;
  try {
    response = await axios.post(url, body, {
      headers,
      timeout: 30000,
      validateStatus: (status) => status < 500,
      transformRequest: [() => raw],
    });
  } catch (err) {
    // Network failure / 5xx: account state is unknown - the caller must not record a decision.
    throw commandError(`Payment ${action} unavailable. Nothing was recorded; retry the action.`, 503, "ACCOUNT_UNAVAILABLE");
  }
  if (response.status >= 400) {
    const message =
      response.data?.error?.message || response.data?.message || `Payment ${action} failed (${response.status})`;
    const code = response.data?.error?.code || response.data?.code || "PAYMENT_COMMAND_REFUSED";
    const error = commandError(message, response.status === 404 ? 404 : 409, code);
    error.responseData = response.data;
    throw error;
  }
  const data = normalizeCommandResult(action, response.data?.data || response.data || {});
  if (data.status) data.displayStatus = normalizePaymentStatus(data.status);
  return data;
}

async function callPaymentIntentAction({
  paymentIntentId,
  action,
  tenantId,
  req = null,
  command = null,
}) {
  const intentId = String(paymentIntentId || "").trim();
  if (!intentId) {
    throw new Error("PaymentIntent ID is required");
  }

  if (paymentCommandMode() === "bound") {
    return callBoundPaymentIntentAction({ intentId, action, tenantId, req, command });
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

/**
 * `command` = { applicationId, actorUserId, paymentId? } - the business object being decided.
 * Ignored in legacy mode; required in bound mode.
 */
async function capturePaymentIntent(paymentIntentId, tenantId, req = null, command = null) {
  return callPaymentIntentAction({
    paymentIntentId,
    action: "capture",
    tenantId,
    req,
    command,
  });
}

async function cancelPaymentIntent(paymentIntentId, tenantId, req = null, command = null) {
  return callPaymentIntentAction({
    paymentIntentId,
    action: "cancel",
    tenantId,
    req,
    command,
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
  paymentCommandMode,
  boundIdempotencyKey,
  ACCOUNT_SERVICE_URL,
};

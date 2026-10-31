/**
 * Tenant resolution for RabbitMQ consumers.
 *
 * The rabbitmq-middleware envelope carries `tenantId` at the top level (set by
 * the publisher from its own trusted context); some producers only put it in
 * `data`. The envelope wins. If both are present and disagree the event is
 * refused — a body tenant must never re-route a write into another tenant.
 */
function normalize(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return "";
  return String(value).trim();
}

/**
 * @param {object} payload full message envelope ({ tenantId?, data: {...} })
 * @returns {{ ok: true, tenantId: string } | { ok: false, reason: "missing"|"mismatch" }}
 */
function resolveEventTenantId(payload) {
  const envelopeTenant = normalize(payload && payload.tenantId);
  const dataTenant = normalize(payload && payload.data && payload.data.tenantId);
  if (envelopeTenant && dataTenant && envelopeTenant !== dataTenant) {
    return { ok: false, reason: "mismatch" };
  }
  const tenantId = envelopeTenant || dataTenant;
  if (!tenantId) return { ok: false, reason: "missing" };
  return { ok: true, tenantId };
}

const INTERNAL_TENANT_ID = /^[0-9a-f]{24}$/;

/**
 * Strict tenant for the payment-link events from account-service (payments.payment-link.*,
 * payments.application-payment.*). No body fallback: the envelope tenantId (set by the
 * producer's publisher from its own trusted context) is required and must be an internal
 * ProjectShell tenant id; a data.tenantId, when present, must equal it. Other consumers keep
 * resolveEventTenantId.
 * @returns {{ ok: true, tenantId: string } | { ok: false, reason: "missing_envelope_tenant"|"invalid_envelope_tenant"|"tenant_mismatch" }}
 */
function requireEnvelopeTenantId(payload) {
  const raw = payload && payload.tenantId;
  if (raw !== undefined && raw !== null && typeof raw !== "string") return { ok: false, reason: "invalid_envelope_tenant" };
  const envelope = typeof raw === "string" ? raw.trim() : "";
  if (!envelope) return { ok: false, reason: "missing_envelope_tenant" };
  if (!INTERNAL_TENANT_ID.test(envelope)) return { ok: false, reason: "invalid_envelope_tenant" };
  const body = payload && payload.data && typeof payload.data === "object" ? payload.data.tenantId : undefined;
  if (body !== undefined && body !== null && (typeof body !== "string" || (body.trim() && body.trim() !== envelope))) {
    return { ok: false, reason: "tenant_mismatch" };
  }
  return { ok: true, tenantId: envelope };
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive exact-match RegExp for an email (metacharacters escaped). */
function exactEmailRegex(email) {
  return new RegExp(`^${escapeRegex(String(email).trim())}$`, "i");
}

module.exports = { resolveEventTenantId, requireEnvelopeTenantId, escapeRegex, exactEmailRegex };

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

/** Escape a string for literal use inside a RegExp. */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive exact-match RegExp for an email (metacharacters escaped). */
function exactEmailRegex(email) {
  return new RegExp(`^${escapeRegex(String(email).trim())}$`, "i");
}

module.exports = { resolveEventTenantId, escapeRegex, exactEmailRegex };

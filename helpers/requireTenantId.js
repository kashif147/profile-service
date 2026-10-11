const { AppError } = require("../errors/AppError");

/**
 * Fail closed when the trusted tenant is missing. Handlers that scope reads/writes by
 * tenant must never run an unscoped query because the caller had no tenant context.
 * Returns the tenantId unchanged so it can be used inline in a query object.
 */
function requireTenantId(tenantId) {
  if (tenantId == null || String(tenantId).trim() === "") {
    throw AppError.unauthorized("Tenant context required");
  }
  return tenantId;
}

module.exports = { requireTenantId };

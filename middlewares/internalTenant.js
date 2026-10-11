const jwt = require("jsonwebtoken");
const bizLogger = require("../config/bizLogger.js");

/**
 * Tenant resolution for the pre-`authenticate` routes in profile.routes.js
 * (`/profile/internal/*`, `/profile/batch`). These are reached by other services
 * over the internal network, and must keep working for them, but must never let
 * a body/query `tenantId` decide which tenant's data is read or written.
 *
 * Precedence (first match wins):
 *   1. Gateway identity (`x-jwt-verified: true` + `x-auth-source: gateway` +
 *      `x-user-id` + `x-tenant-id`)  -> mode "user", tenant = gateway tenant.
 *   2. A Bearer JWT that verifies against JWT_SECRET -> mode "user", tenant =
 *      the token's tenant claim. A JWT that does NOT verify is ignored (an
 *      internal caller replaying an expired user token falls through to 3).
 *   3. `x-internal-request: true|1` with no user identity -> mode "internal",
 *      tenant = the internal caller's `x-tenant-id` header. The DEV gateway
 *      strips client-supplied `x-internal-request`, so this only arrives from
 *      the internal network. (S2S auth itself is not redesigned here.)
 *
 * In every mode a caller-supplied body/query `tenantId` must equal the resolved
 * tenant or the request is rejected (403) — it is never authoritative. When a
 * user identity is present, the internal header grants nothing extra and the
 * `x-tenant-id` header (outside the gateway identity) is ignored.
 */

function toTenantString(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object" && !(value && typeof value.toHexString === "function")) {
    // Reject operator objects ({ $ne: ... }) and arrays outright.
    return "[object]";
  }
  try {
    return value.toString();
  } catch (_e) {
    return String(value);
  }
}

function isInternalFlag(req) {
  const v = req.headers && req.headers["x-internal-request"];
  return v === "true" || v === "1";
}

function nonEmpty(value) {
  const s = toTenantString(value);
  if (!s || s === "[object]") return undefined;
  return s.trim() ? s.trim() : undefined;
}

function gatewayIdentity(req) {
  const h = req.headers || {};
  if (h["x-jwt-verified"] !== "true" || h["x-auth-source"] !== "gateway") {
    return null;
  }
  const userId = nonEmpty(h["x-user-id"]);
  const tenantId = nonEmpty(h["x-tenant-id"]);
  if (!userId || !tenantId) return null;
  return { userId, tenantId, userType: h["x-user-type"] || null };
}

function bearerIdentity(req) {
  const h = req.headers || {};
  const authHeader = h.authorization || h.Authorization;
  if (!authHeader || !String(authHeader).startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.verify(String(authHeader).substring(7), process.env.JWT_SECRET);
    const tenantId = nonEmpty(
      decoded.tenantId || decoded.tid || decoded.extension_tenantId,
    );
    if (!tenantId) return null;
    return { decoded, tenantId };
  } catch (_e) {
    return null;
  }
}

/**
 * @returns {{ ok: true, tenantId: string, mode: "user"|"internal" }
 *          | { ok: false, status: number, message: string }}
 */
function resolveInternalCallerTenant(req, { allowUserIdentity = true, requireInternalFlag = true } = {}) {
  const internal = isInternalFlag(req);
  let tenantId;
  let mode;

  const gw = gatewayIdentity(req);
  const bearer = gw ? null : bearerIdentity(req);

  if (gw || bearer) {
    if (requireInternalFlag && !internal) {
      return {
        ok: false,
        status: 403,
        message: "Internal endpoint: x-internal-request header required",
      };
    }
    if (!allowUserIdentity && !internal) {
      return { ok: false, status: 403, message: "Internal endpoint" };
    }
    mode = "user";
    tenantId = gw ? gw.tenantId : bearer.tenantId;
    if (bearer) {
      req.user = bearer.decoded;
      req.userId = bearer.decoded.sub || bearer.decoded.id;
    } else {
      req.userId = gw.userId;
      req.user = { id: gw.userId, tenantId: gw.tenantId, userType: gw.userType };
    }
  } else if (internal) {
    mode = "internal";
    tenantId = nonEmpty(req.headers["x-tenant-id"]);
    if (!tenantId) {
      // Legacy internal caller compatibility (user-service membershipCheck
      // sends `?tenantId=` with x-internal-request and no x-tenant-id). In
      // internal-only mode the header and the param are the same trust level
      // (both declared by the internal caller); this is never reachable with a
      // user identity. Logged so the caller can be migrated to the header.
      const declared =
        nonEmpty(req.query && req.query.tenantId) || nonEmpty(req.body && req.body.tenantId);
      if (declared) {
        tenantId = declared;
        try {
          bizLogger.business(
            "Internal caller declared tenant via param instead of x-tenant-id",
            {
              eventType: "InternalTenantFromParam",
              method: (req.method || "").toUpperCase(),
              path: req.originalUrl || req.url,
            },
            req,
          );
        } catch (_e) {
          /* logging must never break the request */
        }
      }
    }
    if (!tenantId) {
      return {
        ok: false,
        status: 400,
        message: "Internal request requires x-tenant-id header",
      };
    }
  } else {
    return {
      ok: false,
      status: requireInternalFlag ? 403 : 401,
      message: requireInternalFlag
        ? "Internal endpoint: x-internal-request header required"
        : "Authorization (Bearer) or internal request (x-internal-request + x-tenant-id) required",
    };
  }

  const supplied = [];
  const bodyTenant = req.body && req.body.tenantId;
  const queryTenant = req.query && req.query.tenantId;
  if (bodyTenant !== undefined && bodyTenant !== null && bodyTenant !== "") {
    supplied.push({ source: "body", value: toTenantString(bodyTenant) });
  }
  if (queryTenant !== undefined && queryTenant !== null && queryTenant !== "") {
    supplied.push({ source: "query", value: toTenantString(queryTenant) });
  }
  const mismatch = supplied.filter((s) => s.value !== tenantId).map((s) => s.source);
  if (mismatch.length) {
    try {
      bizLogger.business(
        "Internal route caller-supplied tenantId does not match resolved tenant",
        {
          eventType: "InternalTenantMismatch",
          method: (req.method || "").toUpperCase(),
          path: req.originalUrl || req.url,
          mode,
          suppliedSources: mismatch,
          outcome: "rejected",
        },
        req,
      );
    } catch (_e) {
      /* logging must never break the request */
    }
    return { ok: false, status: 403, message: "Tenant context mismatch" };
  }

  req.tenantId = tenantId;
  req.internalTenantMode = mode;
  return { ok: true, tenantId, mode };
}

module.exports = { resolveInternalCallerTenant, isInternalFlag };

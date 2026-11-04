/**
 * P5 signed service authority - profile-service VERIFIER for signed internal service reads.
 *
 * One operation today:
 *   GET /api/internal/applications/:applicationId/refund-state   application_refund_state
 *   caller allow-list: account-service only
 *
 * This is the only authority on the route: there is NO user token, NO gateway identity and NO
 * profile PDP permission check (CRM finance authorization is decided once, at account-service's
 * refund endpoint). The signed tenant (x-tenant-id) is the only tenant the handler may read.
 *
 * Protocol: p5-svc-sig/1 (services/serviceSignatureVerify.js), audience "profile-service". The
 * operation is bound by the signed method + exact target path (this verifier is mounted on exactly
 * one method/path); idem and body are empty for this GET (no Idempotency-Key, no body).
 *
 * Checks, in order (each failure is a DISTINCT code; nothing below the verifier runs on failure):
 *   0. request carries ANY user / gateway identity header (Authorization, x-jwt-verified,
 *      x-auth-source, x-user-*, x-token-expires-at, x-gateway-*, x-platform-*): the route is not
 *      exposed through the gateway, in any mode, even with a valid signature
 *                                                         -> 404 NOT_FOUND (same as an unknown route)
 *   1. mode off                                           -> 503 APPLICATION_STATE_LOOKUP_DISABLED
 *   2. a request body is present                          -> 401 SERVICE_AUTH_MALFORMED
 *   3. no signature headers at all                        -> 401 SERVICE_AUTH_REQUIRED
 *      headers malformed / wrong version / tenant malformed -> 401 SERVICE_AUTH_MALFORMED
 *   4. caller not allow-listed for this operation         -> 403 SERVICE_NOT_ALLOWED
 *   5. no usable key map configured for the caller        -> 503 SERVICE_AUTH_NOT_CONFIGURED
 *      (verifier misconfiguration, not a caller fault)
 *   6. kid not in the caller's key map                    -> 401 SERVICE_AUTH_UNKNOWN_KID
 *   7. |now - ts| > 60 s                                  -> 401 SERVICE_AUTH_STALE
 *   8. HMAC over aud, caller, kid, method, exact path + raw query, x-tenant-id, idem (empty),
 *      sha256(empty body), ts, nonce; constant time      -> 401 SERVICE_AUTH_INVALID
 *   9. nonce recorded once (unique (caller, nonce), TTL)  -> 401 SERVICE_AUTH_REPLAY
 *      replay store unavailable                          -> 503 SERVICE_AUTH_STORE_UNAVAILABLE
 *
 * Mode: APPLICATION_STATE_SERVICE_AUTH_MODE (off | report | enforce, read per request; same
 * <scope>_SERVICE_AUTH_MODE convention as account-service's PAYMENT_SERVICE_AUTH_MODE).
 *   off (default) - kill switch: the route answers 503 and reads nothing.
 *   report        - full verification; a failure is REJECTED exactly as in enforce; every outcome
 *                   (valid included) is logged.
 *   enforce       - full verification; failures are logged.
 * Unlike account-service's payment routes, report never lets a failed request through: there is
 * no other authority behind this route (no user token chain, no PDP), so a non-rejecting mode
 * would serve unauthenticated application state.
 *
 * Logs carry only operation, mode, outcome code, caller and kid - never the signature, nonce,
 * secret, headers or tenant data.
 */
const mongoose = require("mongoose");
const bizLogger = require("../config/bizLogger.js");
const {
  HEADERS,
  canonicalString,
  headerShapeError,
  keyMapEnvName,
  parseKeyMap,
  sha256Hex,
  signCanonical,
  signaturesEqual,
  withinSkew,
} = require("../services/serviceSignatureVerify");

const MODE_ENV = "APPLICATION_STATE_SERVICE_AUTH_MODE";

const OPERATIONS = Object.freeze({
  application_refund_state: Object.freeze({ method: "GET", callers: Object.freeze(["account-service"]) }),
});

const STATUS = Object.freeze({
  APPLICATION_STATE_LOOKUP_DISABLED: 503,
  NOT_FOUND: 404,
  SERVICE_AUTH_REQUIRED: 401,
  SERVICE_AUTH_MALFORMED: 401,
  SERVICE_NOT_ALLOWED: 403,
  SERVICE_AUTH_NOT_CONFIGURED: 503,
  SERVICE_AUTH_UNKNOWN_KID: 401,
  SERVICE_AUTH_STALE: 401,
  SERVICE_AUTH_INVALID: 401,
  SERVICE_AUTH_REPLAY: 401,
  SERVICE_AUTH_STORE_UNAVAILABLE: 503,
});

const TENANT_RE = /^[a-f0-9]{24}$/;

function serviceAuthMode(env = process.env) {
  const m = String(env[MODE_ENV] || "off").trim().toLowerCase();
  return m === "report" || m === "enforce" ? m : "off";
}

function header(req, name) {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

// Any user / gateway identity marker. The DEV gateway sets x-jwt-verified, x-auth-source, x-user-*
// and x-token-expires-at on every JWT location and passes Authorization through; the signed caller
// (account-service) never sends any of them. A request carrying ANY of them is treated as
// gateway / user traffic and answered 404, in every mode and even with a valid signature, so a
// user identity can never be mixed into (or substituted for) the service authority and the route
// is never revealed (no 401/503 that would confirm it exists).
const IDENTITY_HEADER_PREFIXES = ["x-user-", "x-gateway-", "x-platform-"];
const IDENTITY_HEADERS = ["authorization", "x-jwt-verified", "x-auth-source", "x-token-expires-at", "x-service-secret", "x-ms-token-aad-access-token", "x-ms-token-aad-id-token"];
function hasGatewayIdentity(req) {
  for (const name of Object.keys(req.headers || {})) {
    const n = name.toLowerCase();
    if (IDENTITY_HEADERS.includes(n) || IDENTITY_HEADER_PREFIXES.some((p) => n.startsWith(p))) return true;
  }
  return false;
}

function hasBody(req) {
  const len = req.headers["content-length"];
  if (req.headers["transfer-encoding"] != null) return true;
  return len != null && String(len).trim() !== "0";
}

let nonceIndexReady = null;
function defaultStoreReady(Model) {
  if (mongoose.connection.readyState !== 1) return Promise.resolve(false);
  // The unique (caller, nonce) index IS the replay guarantee: wait for it once before the first
  // insert (a failed build is retried on the next request).
  if (!nonceIndexReady) {
    nonceIndexReady = Model.init().then(
      () => true,
      () => {
        nonceIndexReady = null;
        return false;
      },
    );
  }
  return nonceIndexReady;
}

async function recordNonce(deps, caller, nonce) {
  const Model = deps.NonceModel || require("../models/serviceAuthNonce.model.js");
  const ready = deps.storeReady ? deps.storeReady(Model) : defaultStoreReady(Model);
  try {
    if (!(await ready)) return "SERVICE_AUTH_STORE_UNAVAILABLE";
    await Model.create({ caller, nonce, createdAt: new Date() });
    return null;
  } catch (err) {
    if (err && err.code === 11000) return "SERVICE_AUTH_REPLAY";
    return "SERVICE_AUTH_STORE_UNAVAILABLE";
  }
}

/**
 * Evaluates one request. Returns { outcome, caller, kid, tenantId }: outcome "valid" or a STATUS
 * code. Side effect: a valid signature records its nonce (one-time).
 */
async function evaluate(req, operation, deps = {}) {
  const env = deps.env || process.env;
  const now = deps.nowSeconds ? deps.nowSeconds() : Math.floor(Date.now() / 1000);
  const op = OPERATIONS[operation];
  const h = {
    version: header(req, HEADERS.version),
    caller: header(req, HEADERS.caller),
    kid: header(req, HEADERS.kid),
    ts: header(req, HEADERS.ts),
    nonce: header(req, HEADERS.nonce),
    sig: header(req, HEADERS.sig),
  };
  const out = (outcome, extra = {}) => ({ outcome, caller: null, kid: null, tenantId: null, ...extra });
  if (hasGatewayIdentity(req)) return out("NOT_FOUND");
  if (String(req.method || "").toUpperCase() !== op.method) return out("NOT_FOUND");
  if (hasBody(req)) return out("SERVICE_AUTH_MALFORMED");
  if (!h.sig && !h.caller && !h.nonce) return out("SERVICE_AUTH_REQUIRED");
  if (headerShapeError(h)) return out("SERVICE_AUTH_MALFORMED");
  const tenantId = header(req, "x-tenant-id");
  if (!TENANT_RE.test(String(tenantId || ""))) return out("SERVICE_AUTH_MALFORMED", { caller: h.caller });
  if (!op.callers.includes(h.caller)) return out("SERVICE_NOT_ALLOWED", { caller: h.caller });
  const keys = parseKeyMap(env[keyMapEnvName(h.caller)]);
  if (!keys.size) return out("SERVICE_AUTH_NOT_CONFIGURED", { caller: h.caller });
  const secret = keys.get(h.kid);
  if (!secret) return out("SERVICE_AUTH_UNKNOWN_KID", { caller: h.caller, kid: h.kid });
  if (!withinSkew(h.ts, now)) return out("SERVICE_AUTH_STALE", { caller: h.caller, kid: h.kid });
  const canonical = canonicalString({
    caller: h.caller,
    kid: h.kid,
    method: req.method,
    target: req.originalUrl,
    tenant: tenantId,
    idem: "",
    bodySha256: sha256Hex(Buffer.alloc(0)),
    ts: h.ts,
    nonce: h.nonce,
  });
  if (!signaturesEqual(signCanonical(secret, canonical), h.sig)) {
    return out("SERVICE_AUTH_INVALID", { caller: h.caller, kid: h.kid });
  }
  const nonceError = await recordNonce(deps, h.caller, h.nonce);
  if (nonceError) return out(nonceError, { caller: h.caller, kid: h.kid });
  return { outcome: "valid", caller: h.caller, kid: h.kid, tenantId };
}

function log(deps, level, fields) {
  try {
    if (deps.logger) return deps.logger[level](fields);
    bizLogger.business("[service-auth] signed internal read", { eventType: "ServiceSignatureAuth", level, ...fields });
  } catch (_e) {
    /* logging must never break the request */
  }
  return undefined;
}

function createServiceSignatureAuth(operation, deps = {}) {
  if (!OPERATIONS[operation]) throw new Error(`unknown signed operation ${operation}`);
  return async function serviceSignatureAuth(req, res, next) {
    const env = deps.env || process.env;
    const mode = serviceAuthMode(env);
    res.set("Cache-Control", "no-store");
    let result;
    if (hasGatewayIdentity(req)) {
      // Not exposed through the gateway in ANY mode (also not as a 503 that would reveal it).
      result = { outcome: "NOT_FOUND", caller: null, kid: null };
    } else if (mode === "off") {
      result = { outcome: "APPLICATION_STATE_LOOKUP_DISABLED", caller: null, kid: null };
    } else {
      try {
        result = await evaluate(req, operation, deps);
      } catch (_e) {
        result = { outcome: "SERVICE_AUTH_STORE_UNAVAILABLE", caller: null, kid: null };
      }
    }
    const valid = result.outcome === "valid";
    if (!valid || mode === "report") {
      log(deps, valid ? "info" : "warn", { operation, mode, outcome: result.outcome, caller: result.caller, kid: result.kid });
    }
    if (valid) {
      req.serviceAuth = { caller: result.caller, kid: result.kid, tenantId: result.tenantId, operation };
      return next();
    }
    if (result.outcome === "NOT_FOUND") {
      return res.status(404).json({ error: "NOT_FOUND", message: "Not found", path: req.originalUrl });
    }
    return res.status(STATUS[result.outcome] || 401).json({
      success: false,
      code: result.outcome,
      message:
        result.outcome === "APPLICATION_STATE_LOOKUP_DISABLED"
          ? "Application state lookup is disabled"
          : STATUS[result.outcome] === 503
            ? "Service authentication is unavailable"
            : "Service authentication failed",
    });
  };
}

module.exports = {
  MODE_ENV,
  OPERATIONS,
  STATUS,
  serviceAuthMode,
  evaluate,
  createServiceSignatureAuth,
};

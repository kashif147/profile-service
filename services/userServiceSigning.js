/**
 * PDP P3 (O6 / N3) - signer side of p5-svc-sig/1 for profile-service -> user-service signed reads.
 *
 * One operation: GET /internal/tenants/:tenantId/creditor-profile (user-service operation
 * tenant_creditor_profile, audience "user-service", caller "profile-service"). The canonicalization is
 * services/accountCommandSigning.js's, unchanged (reused, not copied): only the audience differs. Shared vectors:
 * contracts/p5-service-signing.tenant-creditor-profile.v1.json (byte-identical in user-service, SHA-256 pinned)
 * and contracts/p5-service-signing.v1.json.
 *
 * Config (this service's own runtime env file only; a credential of its own, never JWT_SECRET, never the account
 * signing key): USER_SIGNING_KID, USER_SIGNING_SECRET (>= 32 chars).
 *   not configured  -> null (the caller fails closed, see tenant.service.client.js fetchCreditorContext)
 *   misconfigured   -> 503 USER_SIGNING_MISCONFIGURED (reason logged, never a value)
 * A GET has no Idempotency-Key and no body: idem "" and sha256("") are signed. Never logs the secret,
 * signature or nonce.
 */
const crypto = require("crypto");
const { AppError } = require("../errors/AppError");
const {
  VERSION,
  CALLER,
  sha256Hex,
  canonicalString,
  signCanonical,
  targetOf,
} = require("./accountCommandSigning");

const AUDIENCE = "user-service";
const MIN_SECRET_LENGTH = 32;
const KID_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** Returns { kid, secret } or null when not configured; throws 503 when misconfigured. */
function userSigningConfig(env = process.env) {
  const kid = String(env.USER_SIGNING_KID || "").trim();
  const secret = String(env.USER_SIGNING_SECRET || "");
  if (!kid && !secret) return null;
  if (!KID_RE.test(kid) || secret.length < MIN_SECRET_LENGTH) {
    const reason = !KID_RE.test(kid) ? "kid_format" : "secret_length";
    console.error(`[svc-sign] user-service signing misconfigured caller=${CALLER} reason=${reason}`);
    throw new AppError("User-service request signing is misconfigured.", 503, "USER_SIGNING_MISCONFIGURED");
  }
  return { kid, secret };
}

/** Signature headers for one bodiless GET to user-service, or null when signing is not configured. */
function signedGetHeaders({ url, tenant, env = process.env, now = Date.now(), nonce }) {
  const cfg = userSigningConfig(env);
  if (!cfg) return null;
  const ts = String(Math.floor(now / 1000));
  const nonceV = nonce || crypto.randomBytes(18).toString("base64url");
  const canonical = canonicalString({
    aud: AUDIENCE,
    caller: CALLER,
    kid: cfg.kid,
    method: "GET",
    target: targetOf(url),
    tenant,
    idem: "",
    bodySha256: sha256Hex(Buffer.alloc(0)),
    ts,
    nonce: nonceV,
  });
  return {
    "x-svc-version": VERSION,
    "x-svc-caller": CALLER,
    "x-svc-kid": cfg.kid,
    "x-svc-ts": ts,
    "x-svc-nonce": nonceV,
    "x-svc-sig": signCanonical(cfg.secret, canonical),
  };
}

module.exports = { AUDIENCE, userSigningConfig, signedGetHeaders };

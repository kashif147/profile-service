/**
 * P5 signed service authority - protocol "p5-svc-sig" version 1, VERIFIER primitive for
 * profile-service (audience "profile-service").
 *
 * Local CommonJS copy of the reviewed algorithm (account-service src/lib/serviceSigning.js on the
 * S3 branch; profile-service services/accountCommandSigning.js is the signer-side copy). No
 * cross-service import. contracts/p5-service-signing.application-refund-state.v1.json holds the
 * shared vectors (byte-identical in account-service, SHA-256 pinned in both suites); its first
 * vector reproduces p5-service-signing.v1.json's first vector, so this copy is provably the same
 * canonicalization.
 *
 * Canonical string (UTF-8), one field per line, fixed order, each value LENGTH-PREFIXED
 * (`<name>=<utf8 byte length>:<value>`), joined with "\n", no trailing newline:
 *   p5-svc-sig/1, aud, caller, kid, method (UPPERCASE), target (exact path + raw query as sent),
 *   tenant (x-tenant-id), idem (Idempotency-Key), body (hex sha256 of the exact body bytes), ts, nonce
 * Signature = base64url(HMAC-SHA256(secret, canonical)), no padding.
 */
const crypto = require("crypto");

const PROTOCOL = "p5-svc-sig";
const VERSION = "1";
const AUDIENCE = "profile-service";
const MAX_SKEW_SECONDS = 60;
const MIN_SECRET_LENGTH = 32;

const HEADERS = Object.freeze({
  version: "x-svc-version",
  caller: "x-svc-caller",
  kid: "x-svc-kid",
  ts: "x-svc-ts",
  nonce: "x-svc-nonce",
  sig: "x-svc-sig",
});

const CALLER_RE = /^[a-z][a-z0-9-]{0,63}$/;
const KID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{22,128}$/;
const TS_RE = /^[0-9]{1,12}$/;
const SIG_RE = /^[A-Za-z0-9_-]{43}$/; // 32-byte HMAC-SHA256, base64url, no padding

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes || Buffer.alloc(0)).digest("hex");
}

function field(name, value) {
  const v = value == null ? "" : String(value);
  return `${name}=${Buffer.byteLength(v, "utf8")}:${v}`;
}

function canonicalString({ caller, kid, method, target, tenant, idem, bodySha256, ts, nonce, aud = AUDIENCE }) {
  return [
    `${PROTOCOL}/${VERSION}`,
    field("aud", aud),
    field("caller", caller),
    field("kid", kid),
    field("method", String(method || "").toUpperCase()),
    field("target", target),
    field("tenant", tenant),
    field("idem", idem),
    field("body", bodySha256),
    field("ts", ts),
    field("nonce", nonce),
  ].join("\n");
}

function signCanonical(secret, canonical) {
  return crypto.createHmac("sha256", secret).update(canonical, "utf8").digest("base64url");
}

/** Constant-time comparison; unequal lengths still run one timingSafeEqual. */
function signaturesEqual(expected, given) {
  const a = Buffer.from(String(expected || ""), "utf8");
  const b = Buffer.from(String(given || ""), "utf8");
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * Caller key map "kid:secret[,kid:secret]" (current + next during rotation). Short secrets,
 * malformed kids and duplicates are dropped, so a weak entry can never verify.
 */
function parseKeyMap(raw) {
  const out = new Map();
  for (const part of String(raw || "").split(",")) {
    const entry = part.trim();
    const i = entry.indexOf(":");
    if (i <= 0) continue;
    const kid = entry.slice(0, i);
    const secret = entry.slice(i + 1);
    if (!KID_RE.test(kid) || secret.length < MIN_SECRET_LENGTH || out.has(kid)) continue;
    out.set(kid, secret);
  }
  return out;
}

/** Env var holding a caller's key map on the verifier: SVC_SIGNING_KEYS_<CALLER>. */
function keyMapEnvName(caller) {
  return `SVC_SIGNING_KEYS_${String(caller).toUpperCase().replace(/-/g, "_")}`;
}

/** Header-shape validation (before any secret is touched). Returns a reason or null. */
function headerShapeError(h) {
  if (h.version !== VERSION) return "VERSION";
  if (!CALLER_RE.test(h.caller || "")) return "CALLER_FORMAT";
  if (!KID_RE.test(h.kid || "")) return "KID_FORMAT";
  if (!TS_RE.test(h.ts || "")) return "TS_FORMAT";
  if (!NONCE_RE.test(h.nonce || "")) return "NONCE_FORMAT";
  if (!SIG_RE.test(h.sig || "")) return "SIG_FORMAT";
  return null;
}

function withinSkew(ts, nowSeconds, maxSkew = MAX_SKEW_SECONDS) {
  const t = Number(ts);
  return Number.isSafeInteger(t) && Math.abs(nowSeconds - t) <= maxSkew;
}

module.exports = {
  PROTOCOL,
  VERSION,
  AUDIENCE,
  MAX_SKEW_SECONDS,
  MIN_SECRET_LENGTH,
  HEADERS,
  sha256Hex,
  canonicalString,
  signCanonical,
  signaturesEqual,
  parseKeyMap,
  keyMapEnvName,
  headerShapeError,
  withinSkew,
};

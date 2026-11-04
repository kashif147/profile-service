"use strict";
/**
 * P5: preconditions for CRM application decisions (duplicate-review decision, approve, reject,
 * bulk approval, legacy PUT /applications/status/:id).
 *
 * DUPLICATE_REVIEW_VERSION_MODE (read on every call, so it can be flipped without a redeploy of
 * code paths that cache it):
 *   - "compat" (default, and any value other than exactly "enforce"): a request may omit
 *     expectedReviewVersion and Idempotency-Key. It is then decided against the current review
 *     version and the omission is logged ("[decision-preconditions] compatibility window").
 *   - "enforce": a decision without an Idempotency-Key gets 428 IDEMPOTENCY_KEY_REQUIRED; one
 *     that needs a review version and does not send expectedReviewVersion gets 428
 *     REVIEW_VERSION_REQUIRED. Malformed values are 400 in BOTH modes.
 * A sent expectedReviewVersion is ALWAYS checked against the current version (409
 * REVIEW_VERSION_CONFLICT), whatever the mode.
 */
const { AppError } = require("../errors/AppError.js");

const MODE_ENV = "DUPLICATE_REVIEW_VERSION_MODE";
const MAX_KEY_LENGTH = 200;
// Printable ASCII without spaces: UUIDs, ULIDs and similar opaque client keys.
const KEY_RE = /^[\x21-\x7e]+$/;

let warnedUnknownMode = null;

function reviewVersionMode() {
  const raw = process.env[MODE_ENV];
  const value = raw == null ? "" : String(raw).trim().toLowerCase();
  if (value === "enforce") return "enforce";
  if (value && value !== "compat" && warnedUnknownMode !== value) {
    warnedUnknownMode = value;
    console.warn(`[decision-preconditions] unrecognised ${MODE_ENV}; using compat`, { value });
  }
  return "compat";
}

function headerKey(req) {
  const raw = req?.get?.("Idempotency-Key") ?? req?.headers?.["idempotency-key"];
  if (raw == null) return null;
  return String(raw).trim();
}

/**
 * The request's Idempotency-Key, validated. Returns null when absent (compat). Throws 400
 * IDEMPOTENCY_KEY_INVALID when malformed and, in enforce mode, 428 IDEMPOTENCY_KEY_REQUIRED
 * when absent.
 */
function readIdempotencyKey(req, { mode = reviewVersionMode() } = {}) {
  const key = headerKey(req);
  if (key === null || key === "") {
    if (mode === "enforce") {
      throw new AppError(
        "Idempotency-Key header is required for this decision.",
        428,
        "IDEMPOTENCY_KEY_REQUIRED",
      );
    }
    return null;
  }
  if (key.length > MAX_KEY_LENGTH || !KEY_RE.test(key)) {
    throw new AppError("Idempotency-Key is malformed or too long.", 400, "IDEMPOTENCY_KEY_INVALID");
  }
  return key;
}

/**
 * The expectedReviewVersion sent with a decision, validated. Returns null when absent (compat).
 * Throws 400 REVIEW_VERSION_INVALID when not a non-negative integer and, in enforce mode when
 * `required`, 428 REVIEW_VERSION_REQUIRED when absent.
 */
function readExpectedReviewVersion(value, { required = true, mode = reviewVersionMode() } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required && mode === "enforce") {
      throw new AppError(
        "expectedReviewVersion is required: reload the duplicate review and try again.",
        428,
        "REVIEW_VERSION_REQUIRED",
      );
    }
    return null;
  }
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isInteger(n) || n < 0) {
    throw new AppError("expectedReviewVersion must be a non-negative integer.", 400, "REVIEW_VERSION_INVALID");
  }
  return n;
}

/** 409 REVIEW_VERSION_CONFLICT when a sent version is not the current one. */
function assertExpectedReviewVersion(expected, current) {
  if (expected === null || expected === undefined) return;
  if (expected !== current) {
    throw AppError.conflict(
      "The duplicate review changed since it was loaded. Reload the review and try again.",
      { code: "REVIEW_VERSION_CONFLICT", reviewVersion: current },
    );
  }
}

function logCompatibilityWindow(route, details) {
  console.warn("[decision-preconditions] compatibility window: request without", {
    route,
    ...details,
  });
}

function _resetWarnings() {
  warnedUnknownMode = null;
}

module.exports = {
  MODE_ENV,
  reviewVersionMode,
  readIdempotencyKey,
  readExpectedReviewVersion,
  assertExpectedReviewVersion,
  logCompatibilityWindow,
  _resetWarnings,
};

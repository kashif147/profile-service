/**
 * P5 duplicate-review versioning.
 *
 * duplicateReview.reviewVersion is a monotonically increasing integer bumped on every change that can
 * alter whether an application may be approved (a reviewer decision, or a detection run that writes a
 * new review state). Decisions, idempotent replays and approvals are bound to the version they saw, so
 * a concurrent change is reported (409) instead of silently overriding or being overridden.
 *
 * duplicateReview.inputFingerprint is a hash of the applicant fields the matcher actually uses
 * (services/duplicate.matching.js buildMatchableRecord). A re-detection with an unchanged fingerprint
 * must keep an explicit reviewer decision; a changed fingerprint invalidates it (fresh review needed).
 */
const crypto = require("crypto");
const { DUPLICATE_REVIEW_STATUS } = require("../constants/enums.js");

// Explicit reviewer decisions that a background/manual re-detection must not overwrite while the
// matching input is unchanged. (IGNORED is a legacy terminal state written by detection-era ignore;
// it is treated the same way so a re-run cannot resurrect ignored matches.)
const REVIEWER_DECISION_STATUSES = new Set([
  DUPLICATE_REVIEW_STATUS.MARKED_NEW,
  DUPLICATE_REVIEW_STATUS.LINKED,
  DUPLICATE_REVIEW_STATUS.MERGED,
  DUPLICATE_REVIEW_STATUS.IGNORED,
]);

// The matchable-record fields used for candidate search and scoring (buildMatchableRecord).
const MATCHING_INPUT_FIELDS = Object.freeze([
  "name",
  "forename",
  "surname",
  "email",
  "mobile",
  "dateOfBirth",
  "eircode",
  "addressLine1",
  "nmbiNumber",
  "previousMembershipNo",
  "payrollNo",
]);

function canonicalValue(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  // Dates may arrive as Date or ISO strings: compare by calendar day.
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  return s.toLowerCase();
}

/** Stable hash of the matching-relevant input of a matchable record (never stores the values). */
function matchingInputFingerprint(record) {
  const canonical = MATCHING_INPUT_FIELDS.map((f) => [f, canonicalValue(record?.[f])]);
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 32);
}

function currentReviewVersion(personal) {
  const v = personal?.duplicateReview?.reviewVersion;
  return Number.isInteger(v) && v >= 0 ? v : 0;
}

/** Mongo filter fragment matching a document whose review is still at `version`. */
function reviewVersionFilter(version) {
  if (!version) {
    return {
      $or: [
        { "duplicateReview.reviewVersion": { $exists: false } },
        { "duplicateReview.reviewVersion": null },
        { "duplicateReview.reviewVersion": 0 },
      ],
    };
  }
  return { "duplicateReview.reviewVersion": version };
}

module.exports = {
  REVIEWER_DECISION_STATUSES,
  MATCHING_INPUT_FIELDS,
  matchingInputFingerprint,
  currentReviewVersion,
  reviewVersionFilter,
};

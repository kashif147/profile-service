const REJOIN_PREVIOUS_STATUSES = new Set(["cancelled", "resigned"]);
const REINSTATE_PREVIOUS_STATUSES = new Set(["suspended", "archived"]);

const DEFAULT_ELIGIBLE_CATEGORY_KEYS = [
  "full",
  "full membership",
  "full time",
  "full-time",
  "general",
  "general all grades",
  "general (all grades)",
];

function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ");
}

function eligibleCategoryKeys() {
  const configured = String(process.env.GAP_LETTER_ELIGIBLE_CATEGORIES || "")
    .split(",")
    .map(normalizeKey)
    .filter(Boolean);
  return new Set(
    (configured.length > 0 ? configured : DEFAULT_ELIGIBLE_CATEGORY_KEYS).map(
      normalizeKey,
    ),
  );
}

function isUndergraduateStudentCategory(value) {
  const key = normalizeKey(value);
  return (
    key.includes("undergraduate") &&
    key.includes("student") &&
    !key.includes("postgraduate")
  );
}

function isHonoraryCategory(value) {
  const key = normalizeKey(value);
  return key === "honorary" || /\bhonorary\b/.test(key);
}

function isEligibleFullMembershipCategory(value) {
  const key = normalizeKey(value);
  if (!key) return false;
  if (isUndergraduateStudentCategory(key) || isHonoraryCategory(key)) {
    return false;
  }
  return eligibleCategoryKeys().has(key);
}

function normalizeStatus(value) {
  return String(value ?? "").trim().toLowerCase();
}

function predictMovement(previousSubscription) {
  const previousMembershipStatus = previousSubscription?.subscriptionStatus || null;
  const key = normalizeStatus(previousMembershipStatus);
  if (REJOIN_PREVIOUS_STATUSES.has(key)) {
    return {
      predictedMovement: key === "cancelled" ? "Rejoin - Cancelled" : "Rejoin - Resigned",
      previousMembershipStatus,
      isReturningMember: true,
    };
  }
  if (REINSTATE_PREVIOUS_STATUSES.has(key)) {
    return {
      predictedMovement:
        key === "suspended" ? "Reinstate - Suspended" : "Reinstate - Archived",
      previousMembershipStatus,
      isReturningMember: true,
    };
  }
  return {
    predictedMovement: previousSubscription ? "NewJoin" : "NewJoin",
    previousMembershipStatus,
    isReturningMember: false,
  };
}

function resolveGapLetterEligibility({
  requestedSendGapLetter,
  membershipCategory,
  previousSubscription,
} = {}) {
  const categoryForDecision =
    previousSubscription?.membershipCategory || membershipCategory || null;
  const categoryEligible = isEligibleFullMembershipCategory(categoryForDecision);
  const movement = predictMovement(previousSubscription);
  const defaultSendGapLetter = Boolean(
    movement.isReturningMember && categoryEligible,
  );
  const hasOverride = typeof requestedSendGapLetter === "boolean";
  const sendGapLetter = hasOverride
    ? requestedSendGapLetter
    : defaultSendGapLetter;

  let eligibilityReason = "not_returning_member";
  if (movement.isReturningMember && !categoryEligible) {
    eligibilityReason = "ineligible_membership_category";
  } else if (movement.isReturningMember && categoryEligible) {
    eligibilityReason = "eligible_returning_full_member";
  }
  if (hasOverride) {
    eligibilityReason = sendGapLetter
      ? "user_override_enabled"
      : "user_override_disabled";
  }

  return {
    sendGapLetter,
    defaultSendGapLetter,
    overridden: hasOverride && requestedSendGapLetter !== defaultSendGapLetter,
    eligibilityReason,
    eligibleCategory: categoryEligible,
    categoryForDecision,
    predictedMovement: movement.predictedMovement,
    previousMembershipStatus: movement.previousMembershipStatus,
  };
}

module.exports = {
  resolveGapLetterEligibility,
  isEligibleFullMembershipCategory,
  isUndergraduateStudentCategory,
  isHonoraryCategory,
};

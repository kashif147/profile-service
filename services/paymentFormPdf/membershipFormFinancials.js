/**
 * Membership fee-by-category lookup, intentionally duplicated from subscription-service's
 * `helpers/serviceClient.js` (the owning source of truth for pricing) rather than reached via a
 * cross-service filesystem require — that reach only worked in a local monorepo checkout and
 * throws in any real container deployment (each service's Dockerfile only copies its own repo).
 * This is used purely for PDF display formatting (installment amount text), not billing
 * calculations, so a small, rarely-changing static table is an acceptable duplication. If
 * subscription-service's fee table changes, update both copies.
 */
const MEMBERSHIP_FEE_EUR_BY_KEY = {
  FULL_TIME: 540.0, // €45/month × 12
  PART_TIME: 360.0,
  STUDENT: 120.0,
  RETIRED: 60.0,
  ASSOCIATE: 240.0,
  /** e.g. subscription `membershipCategory` "General all grade" */
  GENERAL_ALL_GRADE: 326.0,
  /** e.g. "Private nursing" / private nursing */
  PRIVATE_NURSING: 243.0,
};

/** Maps normalized keys that might not match the canonical FEE key. */
const MEMBERSHIP_FEE_KEY_ALIASES = {
  FULLTIME: "FULL_TIME",
  PARTTIME: "PART_TIME",
  FT: "FULL_TIME",
  PT: "PART_TIME",
};

/** "Full time", "full_time", "FULL-TIME" → "FULL_TIME" */
function normalizeMembershipCategoryKey(category) {
  if (category == null || category === "") return "";
  return String(category)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getMembershipFeeByCategory(category) {
  const norm = normalizeMembershipCategoryKey(category);
  if (!norm) return 0;
  const key = MEMBERSHIP_FEE_KEY_ALIASES[norm] || norm;
  if (Object.prototype.hasOwnProperty.call(MEMBERSHIP_FEE_EUR_BY_KEY, key)) {
    return MEMBERSHIP_FEE_EUR_BY_KEY[key];
  }
  if (Object.prototype.hasOwnProperty.call(MEMBERSHIP_FEE_EUR_BY_KEY, norm)) {
    return MEMBERSHIP_FEE_EUR_BY_KEY[norm];
  }
  return 0;
}

function normalizeFrequency(raw) {
  if (raw == null || raw === "") return "";
  return String(raw).trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * Maps subscription payment frequency label to periods per year for installment math.
 * Weekly / Fortnightly supported for future enum expansion and plain-text payloads.
 */
function periodsPerYearFromFrequency(raw) {
  const n = normalizeFrequency(raw);
  if (!n) return 12;
  if (
    (n.includes("week") || n === "weekly") &&
    !n.includes("fortnight") &&
    !n.includes("biweek") &&
    n !== "biweekly"
  ) {
    return 52;
  }
  if (
    n.includes("fortnight") ||
    n.includes("biweek") ||
    n === "twoweek" ||
    n === "2week"
  ) {
    return 26;
  }
  if (n.includes("month")) return 12;
  if (n.includes("quarter")) return 4;
  if (
    n.includes("annual") ||
    n.includes("year") ||
    n === "yearly" ||
    n === "once"
  ) {
    return 1;
  }
  return 12;
}

/** Frequency keys aligned with layout env / PDF drawing */
function frequencyLayoutKey(raw) {
  const n = normalizeFrequency(raw);
  if (
    (n.includes("week") || n === "weekly") &&
    !n.includes("fortnight") &&
    !n.includes("biweek") &&
    n !== "biweekly"
  ) {
    return "Weekly";
  }
  if (
    n.includes("fortnight") ||
    n.includes("biweek") ||
    n === "biweekly"
  ) {
    return "Fortnightly";
  }
  if (n.includes("month")) return "Monthly";
  if (n.includes("quarter")) return "Quarterly";
  if (
    n.includes("annual") ||
    n.includes("year") ||
    n === "yearly"
  ) {
    return "Annually";
  }
  return "Monthly";
}

/**
 * Annual subscription fee in euros — explicit subscription fields first, then category table.
 */
function resolveAnnualFeeEuros(subscriptionDetails = {}) {
  const sd = subscriptionDetails;
  const tryNum = (v) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? x : 0;
  };

  const explicit = [
    sd.membershipFeeAnnualEur,
    sd.annualMembershipFee,
    sd.membershipFee,
    sd.invoiceAmountEur,
    sd.invoiceTotalEur,
    sd.subscriptionFeeAnnual,
  ];
  for (const c of explicit) {
    const v = tryNum(c);
    if (v > 0) return v;
  }

  const fromCategory = tryNum(getMembershipFeeByCategory(sd.membershipCategory));
  return fromCategory > 0 ? fromCategory : 0;
}

function formatInstallmentEuro(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function computeInstallmentDisplay(subscriptionDetails = {}) {
  const annual = resolveAnnualFeeEuros(subscriptionDetails);
  const periods = periodsPerYearFromFrequency(
    subscriptionDetails.paymentFrequency,
  );
  if (!annual || !periods) return { amountStr: "", periods };
  const per = annual / periods;
  return {
    amountStr: formatInstallmentEuro(per),
    annualEur: annual,
    periods,
    layoutFreqKey: frequencyLayoutKey(subscriptionDetails.paymentFrequency),
  };
}

module.exports = {
  periodsPerYearFromFrequency,
  frequencyLayoutKey,
  resolveAnnualFeeEuros,
  computeInstallmentDisplay,
};

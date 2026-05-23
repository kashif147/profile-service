const MEMBERSHIP_FEE_EUR_BY_KEY = {
  FULL_TIME: 540.0,
  PART_TIME: 360.0,
  STUDENT: 120.0,
  RETIRED: 60.0,
  ASSOCIATE: 240.0,
  GENERAL_ALL_GRADE: 326.0,
  PRIVATE_NURSING: 243.0,
};

const MEMBERSHIP_FEE_KEY_ALIASES = {
  FULLTIME: "FULL_TIME",
  PARTTIME: "PART_TIME",
  FT: "FULL_TIME",
  PT: "PART_TIME",
};

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

function periodsPerYearFromFrequency(raw) {
  const n = normalizeFrequency(raw);
  if (!n) return 12;
  if (
    (n.includes("week") || n === "weekly") &&
    !n.includes("fortnight") &&
    !n.includes("biweek")
  ) {
    return 52;
  }
  if (n.includes("fortnight") || n.includes("biweek")) return 26;
  if (n.includes("month")) return 12;
  if (n.includes("quarter")) return 4;
  if (n.includes("annual") || n.includes("year")) return 1;
  return 12;
}

function frequencyLayoutKey(raw) {
  const n = normalizeFrequency(raw);
  if (
    (n.includes("week") || n === "weekly") &&
    !n.includes("fortnight") &&
    !n.includes("biweek")
  ) {
    return "Weekly";
  }
  if (n.includes("fortnight") || n.includes("biweek")) return "Fortnightly";
  if (n.includes("month")) return "Monthly";
  if (n.includes("quarter")) return "Quarterly";
  if (n.includes("annual") || n.includes("year")) return "Annually";
  return "Monthly";
}

function formatEurAmount(amount) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

function resolveAnnualFeeEuros(subscriptionDetails = {}) {
  const sd = subscriptionDetails || {};
  const tryNum = (v) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? x : 0;
  };
  const explicit = [
    sd.membershipFeeAnnualEur,
    sd.annualMembershipFee,
    sd.membershipFee,
    sd.financialDetails?.membershipFee,
  ];
  for (const c of explicit) {
    const v = tryNum(c);
    if (v > 0) return v;
  }
  const fromCategory = tryNum(getMembershipFeeByCategory(sd.membershipCategory));
  return fromCategory > 0 ? fromCategory : 0;
}

function computeInstallmentDisplay(subscriptionDetails = {}) {
  const annual = resolveAnnualFeeEuros(subscriptionDetails);
  const periods = periodsPerYearFromFrequency(
    subscriptionDetails.paymentFrequency
  );
  const layoutFreqKey = frequencyLayoutKey(subscriptionDetails.paymentFrequency);
  if (!annual || !periods) {
    return {
      amountStr: "",
      installmentAmountEur: 0,
      annualEur: annual,
      periods,
      layoutFreqKey,
    };
  }
  const per = annual / periods;
  return {
    amountStr: formatEurAmount(per),
    installmentAmountEur: Math.round(per * 100) / 100,
    annualEur: annual,
    periods,
    layoutFreqKey,
  };
}

module.exports = {
  computeInstallmentDisplay,
  frequencyLayoutKey,
  periodsPerYearFromFrequency,
  formatEurAmount,
  getMembershipFeeByCategory,
};

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
  FULL_MEMBER: "FULL_TIME",
  FULL_MEMBERS: "FULL_TIME",
  MEMBER: "FULL_TIME",
  ORDINARY_MEMBER: "FULL_TIME",
  PART_MEMBER: "PART_TIME",
  PART_TIME_MEMBER: "PART_TIME",
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

  const fromCategory = tryNum(getMembershipFeeByCategory(sd.membershipCategory));
  if (fromCategory > 0) return fromCategory;

  for (const c of [sd.membershipFeeAnnualEur, sd.annualMembershipFee]) {
    const v = tryNum(c);
    if (v > 0) return v;
  }

  const fee = tryNum(sd.membershipFee) || tryNum(sd.financialDetails?.membershipFee);
  if (fee <= 0) return 0;

  // Subscription list enrichment often sets membershipFee to the last invoice
  // (per-period), not the annual total — annualize when it matches installment scale.
  const periods = periodsPerYearFromFrequency(sd.paymentFrequency || "Monthly");
  if (periods > 1) {
    const annualized = Math.round(fee * periods * 100) / 100;
    if (annualized >= 60 && annualized <= 5000) {
      return annualized;
    }
  }

  return fee;
}

function computeInstallmentDisplay(subscriptionDetails = {}, options = {}) {
  const paymentFrequency =
    options.paymentFrequency ?? subscriptionDetails.paymentFrequency;
  const annual = resolveAnnualFeeEuros(subscriptionDetails);
  const periods = periodsPerYearFromFrequency(paymentFrequency);
  const layoutFreqKey = frequencyLayoutKey(paymentFrequency);
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

/** Standing order installments default to monthly unless a frequency is supplied. */
function computeStandingOrderInstallment(subscriptionDetails = {}) {
  const freq =
    subscriptionDetails.paymentFrequency &&
    String(subscriptionDetails.paymentFrequency).trim()
      ? subscriptionDetails.paymentFrequency
      : "Monthly";
  return computeInstallmentDisplay(subscriptionDetails, {
    paymentFrequency: freq,
  });
}

module.exports = {
  computeInstallmentDisplay,
  computeStandingOrderInstallment,
  resolveAnnualFeeEuros,
  frequencyLayoutKey,
  periodsPerYearFromFrequency,
  formatEurAmount,
  getMembershipFeeByCategory,
};

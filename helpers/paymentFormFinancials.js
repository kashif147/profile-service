const path = require("path");

function loadGetMembershipFeeByCategory() {
  try {
    const svcPath = path.join(
      __dirname,
      "../../subscription-service/helpers/serviceClient.js"
    );
    const mod = require(svcPath);
    return typeof mod.getMembershipFeeByCategory === "function"
      ? mod.getMembershipFeeByCategory
      : () => 0;
  } catch {
    return () => 0;
  }
}

const getMembershipFeeByCategory = loadGetMembershipFeeByCategory();

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
  if (!annual || !periods) {
    return {
      amountStr: "",
      installmentAmountEur: 0,
      annualEur: annual,
      periods,
      layoutFreqKey: frequencyLayoutKey(subscriptionDetails.paymentFrequency),
    };
  }
  const per = annual / periods;
  return {
    amountStr: new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency: "EUR",
    }).format(per),
    installmentAmountEur: Math.round(per * 100) / 100,
    annualEur: annual,
    periods,
    layoutFreqKey: frequencyLayoutKey(subscriptionDetails.paymentFrequency),
  };
}

module.exports = {
  computeInstallmentDisplay,
  frequencyLayoutKey,
  periodsPerYearFromFrequency,
};

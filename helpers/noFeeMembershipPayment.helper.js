const { PAYMENT_TYPE, PAYMENT_FREQUENCY } = require("../constants/enums");

function normalizeCategoryKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isNoFeeMembershipCategory(membershipCategory) {
  const key = normalizeCategoryKey(membershipCategory);
  if (!key) return false;
  if (key === "honorary" || /\bhonorary\b/.test(key)) return true;
  return (
    key.includes("undergraduate") &&
    key.includes("student") &&
    !key.includes("postgraduate")
  );
}

function hasPaymentTypeValue(paymentType) {
  return String(paymentType ?? "").trim() !== "";
}

function hasPaymentFrequencyValue(paymentFrequency) {
  return String(paymentFrequency ?? "").trim() !== "";
}

/**
 * Honorary and undergraduate student categories have no fee today.
 * Always use Cash + Annually so we do not persist Salary Deduction / Monthly
 * from prior categories or Mongoose defaults.
 */
function applyNoFeeMembershipPaymentDefaults(subscriptionDetails = {}) {
  if (!subscriptionDetails || typeof subscriptionDetails !== "object") {
    return subscriptionDetails;
  }

  if (!isNoFeeMembershipCategory(subscriptionDetails.membershipCategory)) {
    return subscriptionDetails;
  }

  return {
    ...subscriptionDetails,
    paymentType: PAYMENT_TYPE.CASH,
    paymentFrequency: PAYMENT_FREQUENCY.ANNUALLY,
    payrollNo: null,
  };
}

function resolveSubscriptionPaymentFallbacks(membershipCategory) {
  if (isNoFeeMembershipCategory(membershipCategory)) {
    return {
      paymentType: PAYMENT_TYPE.CASH,
      paymentFrequency: PAYMENT_FREQUENCY.ANNUALLY,
    };
  }
  return {
    paymentType: PAYMENT_TYPE.PAYROLL_DEDUCTION,
    paymentFrequency: PAYMENT_FREQUENCY.MONTHLY,
  };
}

module.exports = {
  isNoFeeMembershipCategory,
  applyNoFeeMembershipPaymentDefaults,
  resolveSubscriptionPaymentFallbacks,
  hasPaymentTypeValue,
  hasPaymentFrequencyValue,
};

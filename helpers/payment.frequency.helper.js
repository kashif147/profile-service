const { PAYMENT_TYPE, PAYMENT_FREQUENCY } = require("../constants/enums");

const ALLOWED_FREQUENCIES = new Set(Object.values(PAYMENT_FREQUENCY));

const normalizePaymentTypeKey = (paymentType) =>
  String(paymentType ?? "")
    .trim()
    .toLowerCase();

function isAllowedFrequency(freq) {
  return (
    freq != null &&
    String(freq).trim() !== "" &&
    ALLOWED_FREQUENCIES.has(freq)
  );
}

/** Credit Card, Cheque, Cash → Annually */
function isAnnualDefaultPaymentType(paymentType) {
  const key = normalizePaymentTypeKey(paymentType);
  return (
    key === "credit card" ||
    key === "card payment" ||
    key === "cheque" ||
    key === "check" ||
    key === "cash"
  );
}

/** Standing Order, Salary Deduction, Direct Debit → Monthly */
function isMonthlyDefaultPaymentType(paymentType) {
  const key = normalizePaymentTypeKey(paymentType);
  return (
    key === "standing order" ||
    key === "salary deduction" ||
    key === "payroll deduction" ||
    key === "direct debit"
  );
}

/**
 * Defaults and guards for payment frequency:
 * - Credit Card, Cheque, Cash → Annually
 * - Standing Order, Salary Deduction, Direct Debit → Monthly when missing/invalid
 *
 * @param {Object} subscriptionDetails - Subscription details object
 * @returns {Object} Subscription details with corrected paymentFrequency
 */
function enforcePaymentFrequencyRule(subscriptionDetails) {
  if (!subscriptionDetails || typeof subscriptionDetails !== "object") {
    return subscriptionDetails;
  }

  const paymentType = subscriptionDetails.paymentType;
  const currentFrequency = subscriptionDetails.paymentFrequency;

  if (isAnnualDefaultPaymentType(paymentType)) {
    if (currentFrequency !== PAYMENT_FREQUENCY.ANNUALLY) {
      console.log(
        "📝 [PAYMENT_FREQUENCY_HELPER] Annual payment method — frequency set to Annually:",
        {
          paymentType,
          previousFrequency: currentFrequency,
          newFrequency: PAYMENT_FREQUENCY.ANNUALLY,
        }
      );
      subscriptionDetails.paymentFrequency = PAYMENT_FREQUENCY.ANNUALLY;
    }
    return subscriptionDetails;
  }

  if (isMonthlyDefaultPaymentType(paymentType)) {
    if (!isAllowedFrequency(currentFrequency)) {
      console.log(
        "📝 [PAYMENT_FREQUENCY_HELPER] Monthly payment method — invalid/missing frequency, defaulting to Monthly:",
        {
          paymentType,
          previousFrequency: currentFrequency,
          newFrequency: PAYMENT_FREQUENCY.MONTHLY,
        }
      );
      subscriptionDetails.paymentFrequency = PAYMENT_FREQUENCY.MONTHLY;
    }
    return subscriptionDetails;
  }

  if (paymentType && !isAllowedFrequency(currentFrequency)) {
    subscriptionDetails.paymentFrequency = PAYMENT_FREQUENCY.MONTHLY;
  }

  return subscriptionDetails;
}

module.exports = {
  enforcePaymentFrequencyRule,
  isAnnualDefaultPaymentType,
  isMonthlyDefaultPaymentType,
};

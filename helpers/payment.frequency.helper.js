const { PAYMENT_TYPE, PAYMENT_FREQUENCY } = require("../constants/enums");

const ALLOWED_FREQUENCIES = new Set(Object.values(PAYMENT_FREQUENCY));

function isAllowedFrequency(freq) {
  return (
    freq != null &&
    String(freq).trim() !== "" &&
    ALLOWED_FREQUENCIES.has(freq)
  );
}

/**
 * Defaults and guards for payment frequency:
 * - Credit Card → always Annually (product rule).
 * - Other payment types → keep Weekly/Fortnightly/Monthly/Quarterly/Annually when valid;
 *   if missing or invalid, default to Monthly.
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

  const isCreditCard =
    paymentType === PAYMENT_TYPE.CARD_PAYMENT ||
    paymentType === "Credit Card" ||
    paymentType === "Card Payment";

  if (isCreditCard) {
    if (currentFrequency !== PAYMENT_FREQUENCY.ANNUALLY) {
      console.log(
        "📝 [PAYMENT_FREQUENCY_HELPER] Credit Card — frequency set to Annually:",
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

  if (paymentType && !isCreditCard) {
    if (!isAllowedFrequency(currentFrequency)) {
      console.log(
        "📝 [PAYMENT_FREQUENCY_HELPER] Non-card — invalid/missing frequency, defaulting to Monthly:",
        {
          paymentType,
          previousFrequency: currentFrequency,
          newFrequency: PAYMENT_FREQUENCY.MONTHLY,
        }
      );
      subscriptionDetails.paymentFrequency = PAYMENT_FREQUENCY.MONTHLY;
    }
  }

  return subscriptionDetails;
}

module.exports = {
  enforcePaymentFrequencyRule,
};


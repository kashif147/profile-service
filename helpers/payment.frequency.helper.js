const { PAYMENT_TYPE, PAYMENT_FREQUENCY } = require("../constants/enums");

/**
 * Enforces payment frequency rule based on payment type:
 * - If paymentType is "Credit Card" (CARD_PAYMENT), paymentFrequency must be "Annually"
 * - Otherwise, paymentFrequency should be "Monthly"
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

  // If payment type is Credit Card (CARD_PAYMENT), frequency must be Annually
  // Check for both "Card Payment" and "Credit Card" values
  const isCreditCard =
    paymentType === PAYMENT_TYPE.CARD_PAYMENT ||
    paymentType === "Credit Card" ||
    paymentType === "Card Payment";

  if (isCreditCard) {
    if (currentFrequency !== PAYMENT_FREQUENCY.ANNUALLY) {
      console.log(
        "📝 [PAYMENT_FREQUENCY_HELPER] Credit Card payment type detected - setting frequency to Annually:",
        {
          paymentType,
          previousFrequency: currentFrequency,
          newFrequency: PAYMENT_FREQUENCY.ANNUALLY,
        }
      );
      subscriptionDetails.paymentFrequency = PAYMENT_FREQUENCY.ANNUALLY;
    }
  } else if (paymentType && !isCreditCard) {
    // For all other payment types, frequency should be Monthly
    if (currentFrequency !== PAYMENT_FREQUENCY.MONTHLY) {
      console.log(
        "📝 [PAYMENT_FREQUENCY_HELPER] Non-Credit Card payment type - setting frequency to Monthly:",
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


const { PAYMENT_TYPE } = require("../constants/enums");
const { AppError } = require("../errors/AppError");

const normalizeKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

function isSalaryDeductionPaymentType(paymentType) {
  const key = normalizeKey(paymentType);
  return (
    paymentType === PAYMENT_TYPE.PAYROLL_DEDUCTION || key === "salary deduction"
  );
}

/**
 * Salary deduction eligibility is stored on subscription details when payment
 * is saved (frontend copies lookup configuration from the selected work
 * location). No user-service API or cross-database lookup reads.
 */
function assertSalaryDeductionAllowedForWorkLocation(
  subscriptionDetails,
  professionalDetails,
) {
  if (
    !subscriptionDetails ||
    !isSalaryDeductionPaymentType(subscriptionDetails.paymentType)
  ) {
    return;
  }

  const workLocation = String(professionalDetails?.workLocation || "").trim();
  const allows = !!subscriptionDetails?.processSalaryDeduction;

  if (!allows) {
    throw AppError.badRequest(
      workLocation
        ? `Salary Deduction is not enabled for work location "${workLocation}"`
        : "Salary Deduction requires a work location with payroll deduction enabled",
    );
  }
}

module.exports = {
  assertSalaryDeductionAllowedForWorkLocation,
};

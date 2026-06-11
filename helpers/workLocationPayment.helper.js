const { PAYMENT_TYPE } = require("../constants/enums");
const { AppError } = require("../errors/AppError");
const {
  isSalaryDeductionEnabledForWorkLocation,
} = require("../services/lookup.service.client");

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

async function assertSalaryDeductionAllowedForWorkLocation(
  subscriptionDetails,
  professionalDetails,
  { req = null, tenantId = "" } = {}
) {
  if (
    !subscriptionDetails ||
    !isSalaryDeductionPaymentType(subscriptionDetails.paymentType)
  ) {
    return;
  }

  const workLocation = String(professionalDetails?.workLocation || "").trim();
  const allows = await isSalaryDeductionEnabledForWorkLocation(workLocation, {
    req,
    tenantId,
  });

  if (!allows) {
    throw AppError.badRequest(
      workLocation
        ? `Salary Deduction is not enabled for work location "${workLocation}"`
        : "Salary Deduction requires a work location with payroll deduction enabled"
    );
  }
}

module.exports = {
  assertSalaryDeductionAllowedForWorkLocation,
};

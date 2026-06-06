const mongoose = require("mongoose");
const { PAYMENT_TYPE } = require("../constants/enums");
const { AppError } = require("../errors/AppError");
const {
  getLookupUserDbConnection,
  getLookupModels,
} = require("./lookupUserDb");

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

function buildNamePattern(workLocationLabel) {
  const escaped = String(workLocationLabel).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  return new RegExp(`^${escaped}$`, "i");
}

async function findWorkLocationLookup(workLocationLabel) {
  const labelKey = normalizeKey(workLocationLabel);
  if (!labelKey || labelKey === "other") return null;

  const { Lookup, LookupType } = await getLookupModels(
    await getLookupUserDbConnection(),
  );

  const workLocType = await LookupType.findOne({
    code: "WORKLOC",
    isdeleted: { $ne: true },
  })
    .select("_id lookuptype code")
    .lean();

  const baseFilter = {
    isdeleted: { $ne: true },
    isactive: { $ne: false },
  };

  if (
    mongoose.Types.ObjectId.isValid(workLocationLabel) &&
    String(workLocationLabel).length === 24
  ) {
    const byIdFilter = {
      ...baseFilter,
      _id: workLocationLabel,
    };
    if (workLocType?._id) {
      byIdFilter.lookuptypeId = workLocType._id;
    }
    const byId = await Lookup.findOne(byIdFilter)
      .select("lookupname DisplayName processSalaryDeduction lookuptypeId")
      .lean();
    if (byId) return byId;
  }

  const namePattern = buildNamePattern(workLocationLabel);
  const nameFilter = {
    ...baseFilter,
    $or: [{ lookupname: namePattern }, { DisplayName: namePattern }],
  };
  if (workLocType?._id) {
    nameFilter.lookuptypeId = workLocType._id;
  }

  return Lookup.findOne(nameFilter)
    .select("lookupname DisplayName processSalaryDeduction lookuptypeId")
    .lean();
}

async function resolveWorkLocationProcessSalaryDeduction(workLocationLabel) {
  const match = await findWorkLocationLookup(workLocationLabel);
  return !!match?.processSalaryDeduction;
}

async function assertSalaryDeductionAllowedForWorkLocation(
  subscriptionDetails,
  workLocation,
) {
  if (
    !subscriptionDetails ||
    !isSalaryDeductionPaymentType(subscriptionDetails.paymentType)
  ) {
    return;
  }

  const locationLabel = String(workLocation || "").trim();
  const allows = await resolveWorkLocationProcessSalaryDeduction(locationLabel);
  if (!allows) {
    const match = await findWorkLocationLookup(locationLabel);
    throw AppError.badRequest(
      match
        ? `Salary Deduction is not enabled for work location "${locationLabel}"`
        : `Salary Deduction is not available for work location "${locationLabel || "not set"}"`,
    );
  }
}

module.exports = {
  resolveWorkLocationProcessSalaryDeduction,
  assertSalaryDeductionAllowedForWorkLocation,
};

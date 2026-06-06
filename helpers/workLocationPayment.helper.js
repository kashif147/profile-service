const mongoose = require("mongoose");
const { PAYMENT_TYPE } = require("../constants/enums");
const { AppError } = require("../errors/AppError");

const normalizeKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const isWorkLocationLookupType = (lookupTypeDoc) => {
  if (!lookupTypeDoc) return false;
  const typeName = normalizeKey(lookupTypeDoc.lookuptype).replace(/\s+/g, "");
  const code = normalizeKey(lookupTypeDoc.code);
  return typeName === "worklocation" || code === "workloc";
};

function getLookupModel() {
  try {
    return mongoose.model("Lookup");
  } catch {
    const lookupSchema = new mongoose.Schema(
      {
        code: { type: String, required: true },
        lookupname: { type: String, required: true },
        DisplayName: { type: String },
        Parentlookupid: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Lookup",
          default: null,
        },
        lookuptypeId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "LookupType",
          required: true,
        },
        isdeleted: { type: Boolean, default: false },
        isactive: { type: Boolean, default: true },
        processSalaryDeduction: { type: Boolean, default: false },
        userid: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
      },
      { timestamps: true }
    );
    return mongoose.model("Lookup", lookupSchema);
  }
}

function getLookupTypeModel() {
  try {
    return mongoose.model("LookupType");
  } catch {
    const lookupTypeSchema = new mongoose.Schema(
      {
        code: { type: String, required: true },
        lookuptype: { type: String, required: true },
        displayname: { type: String },
      },
      { timestamps: true }
    );
    return mongoose.model("LookupType", lookupTypeSchema);
  }
}

async function resolveWorkLocationProcessSalaryDeduction(workLocationLabel) {
  const labelKey = normalizeKey(workLocationLabel);
  if (!labelKey || labelKey === "other") return false;

  const Lookup = getLookupModel();
  const escaped = workLocationLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const namePattern = new RegExp(`^${escaped}$`, "i");
  const candidates = await Lookup.find({
    isdeleted: { $ne: true },
    isactive: { $ne: false },
    $or: [{ lookupname: namePattern }, { DisplayName: namePattern }],
  })
    .select("lookupname DisplayName processSalaryDeduction lookuptypeId")
    .lean();

  const LookupType = getLookupTypeModel();
  const typeIds = [
    ...new Set(candidates.map((row) => String(row.lookuptypeId)).filter(Boolean)),
  ];
  const types = typeIds.length
    ? await LookupType.find({ _id: { $in: typeIds } })
        .select("lookuptype code")
        .lean()
    : [];
  const typeById = new Map(types.map((row) => [String(row._id), row]));

  const match = candidates.find((row) => {
    const typeDoc = typeById.get(String(row.lookuptypeId));
    if (!isWorkLocationLookupType(typeDoc)) return false;
    const names = [row.lookupname, row.DisplayName]
      .filter(Boolean)
      .map(normalizeKey);
    return names.includes(labelKey);
  });

  return !!match?.processSalaryDeduction;
}

function isSalaryDeductionPaymentType(paymentType) {
  const key = normalizeKey(paymentType);
  return (
    paymentType === PAYMENT_TYPE.PAYROLL_DEDUCTION || key === "salary deduction"
  );
}

async function assertSalaryDeductionAllowedForWorkLocation(
  subscriptionDetails,
  workLocation
) {
  if (!subscriptionDetails || !isSalaryDeductionPaymentType(subscriptionDetails.paymentType)) {
    return;
  }

  const allows = await resolveWorkLocationProcessSalaryDeduction(workLocation);
  if (!allows) {
    throw AppError.badRequest(
      "Salary Deduction is not available for the selected work location"
    );
  }
}

module.exports = {
  resolveWorkLocationProcessSalaryDeduction,
  assertSalaryDeductionAllowedForWorkLocation,
};

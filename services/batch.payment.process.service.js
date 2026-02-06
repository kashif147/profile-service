const XLSX = require("xlsx");
const BatchDetail = require("../models/batch.detail.model");
const Profile = require("../models/profile.model");
const azureBlob = require("./azure.blob.service");

/**
 * Expected Excel columns (0-based): A=Membership No, B=Last name, C=First name, D=Full name, E=Value for Periods Selected.
 * First row is treated as header.
 */
const COL = {
  MEMBERSHIP_NO: 0,
  LAST_NAME: 1,
  FIRST_NAME: 2,
  FULL_NAME: 3,
  VALUE_FOR_PERIOD: 4,
};

function getCell(row, index) {
  const v = row[index];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function parseRows(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) return [];
  const rows = XLSX.utils.sheet_to_json(firstSheet, {
    header: 1,
    defval: null,
    raw: false,
  });
  if (!rows.length) return [];
  const dataRows = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const membershipNo = getCell(row, COL.MEMBERSHIP_NO);
    if (!membershipNo) continue; // skip empty rows
    dataRows.push({
      rowIndex: i + 1,
      membershipNumber: membershipNo,
      lastName: getCell(row, COL.LAST_NAME),
      firstName: getCell(row, COL.FIRST_NAME),
      fullName: getCell(row, COL.FULL_NAME),
      valueForPeriodSelected: (() => {
        const v = row[COL.VALUE_FOR_PERIOD];
        if (v === undefined || v === null || v === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      })(),
    });
  }
  return dataRows;
}

/**
 * Process a batch detail: download file from Azure, parse Excel, match by membership number.
 * Found members → batchPayments array on BatchDetail; not found → batchExceptions array on BatchDetail.
 * @param {Object} options - { batchDetailId, tenantId }
 * @returns {Promise<{ paymentsCount, exceptionsCount, payments, exceptions, message }>}
 */
async function processBatchDetail({ batchDetailId, tenantId }) {
  const batchDetail = await BatchDetail.findOne({
    _id: batchDetailId,
    isDeleted: false,
  });
  if (!batchDetail) {
    throw new Error("Batch detail not found");
  }
  if (!batchDetail.fileBlobPath) {
    throw new Error("No file attached to this batch detail");
  }
  if (!azureBlob.isConfigured) {
    throw new Error("Azure Storage is not configured");
  }

  const buffer = await azureBlob.downloadBlobToBuffer(batchDetail.fileBlobPath);
  const rows = parseRows(buffer);
  if (rows.length === 0) {
    batchDetail.batchPayments = [];
    batchDetail.batchExceptions = [];
    await batchDetail.save();
    return {
      paymentsCount: 0,
      exceptionsCount: 0,
      payments: [],
      exceptions: [],
      message: "No data rows found in file",
    };
  }

  const tenantFilter = tenantId ? { tenantId } : {};
  const membershipNumbers = [...new Set(rows.map((r) => r.membershipNumber))];
  const profiles = await Profile.find({
    ...tenantFilter,
    membershipNumber: { $in: membershipNumbers },
  })
    .select(
      "membershipNumber personalInfo contactInfo professionalDetails preferences"
    )
    .lean();
  const profileByMembership = new Map(
    profiles.map((p) => [String(p.membershipNumber).trim(), p])
  );

  const batchPayments = [];
  const batchExceptions = [];
  for (const row of rows) {
    const normalizedMembership = String(row.membershipNumber).trim();
    const profile = profileByMembership.get(normalizedMembership);
    if (profile) {
      const pi = profile.personalInfo || {};
      const ci = profile.contactInfo || {};
      const pd = profile.professionalDetails || {};
      const pref = profile.preferences || {};
      batchPayments.push({
        profileId: profile._id,
        membershipNumber: profile.membershipNumber || row.membershipNumber,
        valueForPeriodSelected: row.valueForPeriodSelected,
        rowIndex: row.rowIndex,
        forename: pi.forename ?? null,
        surname: pi.surname ?? null,
        dateOfBirth: pi.dateOfBirth ?? null,
        gender: pi.gender ?? null,
        personalEmail: ci.personalEmail ?? null,
        workEmail: ci.workEmail ?? null,
        mobileNumber: ci.mobileNumber ?? null,
        fullAddress: ci.fullAddress ?? null,
        workLocation: pd.workLocation ?? null,
        grade: pd.grade ?? null,
        primarySection: pd.primarySection ?? null,
        valueAddedServices: pref.valueAddedServices ?? false,
      });
    } else {
      batchExceptions.push({
        membershipNumber: row.membershipNumber,
        lastName: row.lastName,
        firstName: row.firstName,
        fullName: row.fullName,
        valueForPeriodSelected: row.valueForPeriodSelected,
        rowIndex: row.rowIndex,
      });
    }
  }

  batchDetail.batchPayments = batchPayments;
  batchDetail.batchExceptions = batchExceptions;
  await batchDetail.save();

  return {
    paymentsCount: batchPayments.length,
    exceptionsCount: batchExceptions.length,
    payments: batchDetail.batchPayments,
    exceptions: batchDetail.batchExceptions,
    message: `Processed ${rows.length} rows: ${batchPayments.length} matched, ${batchExceptions.length} exceptions.`,
  };
}

/**
 * Process a batch detail using an in-memory buffer (e.g. right after upload).
 * Matches membership number column to profiles; found → batchPayments, not found → batchExceptions.
 * @param {Object} batchDetail - Mongoose BatchDetail document (will be saved)
 * @param {Buffer} buffer - File buffer (e.g. Excel)
 * @param {string|null} tenantId - Optional tenant filter for profiles
 * @returns {Promise<{ paymentsCount, exceptionsCount, payments, exceptions, message }>}
 */
async function processBatchDetailWithBuffer(batchDetail, buffer, tenantId = null) {
  const rows = parseRows(buffer);
  if (rows.length === 0) {
    batchDetail.batchPayments = [];
    batchDetail.batchExceptions = [];
    await batchDetail.save();
    return {
      paymentsCount: 0,
      exceptionsCount: 0,
      payments: [],
      exceptions: [],
      message: "No data rows found in file",
    };
  }

  const tenantFilter = tenantId ? { tenantId } : {};
  const membershipNumbers = [...new Set(rows.map((r) => r.membershipNumber))];
  const profiles = await Profile.find({
    ...tenantFilter,
    membershipNumber: { $in: membershipNumbers },
  })
    .select(
      "membershipNumber personalInfo contactInfo professionalDetails preferences"
    )
    .lean();
  const profileByMembership = new Map(
    profiles.map((p) => [String(p.membershipNumber).trim(), p])
  );

  const batchPayments = [];
  const batchExceptions = [];
  for (const row of rows) {
    const normalizedMembership = String(row.membershipNumber).trim();
    const profile = profileByMembership.get(normalizedMembership);
    if (profile) {
      const pi = profile.personalInfo || {};
      const ci = profile.contactInfo || {};
      const pd = profile.professionalDetails || {};
      const pref = profile.preferences || {};
      batchPayments.push({
        profileId: profile._id,
        membershipNumber: profile.membershipNumber || row.membershipNumber,
        valueForPeriodSelected: row.valueForPeriodSelected,
        rowIndex: row.rowIndex,
        forename: pi.forename ?? null,
        surname: pi.surname ?? null,
        dateOfBirth: pi.dateOfBirth ?? null,
        gender: pi.gender ?? null,
        personalEmail: ci.personalEmail ?? null,
        workEmail: ci.workEmail ?? null,
        mobileNumber: ci.mobileNumber ?? null,
        fullAddress: ci.fullAddress ?? null,
        workLocation: pd.workLocation ?? null,
        grade: pd.grade ?? null,
        primarySection: pd.primarySection ?? null,
        valueAddedServices: pref.valueAddedServices ?? false,
      });
    } else {
      batchExceptions.push({
        membershipNumber: row.membershipNumber,
        lastName: row.lastName,
        firstName: row.firstName,
        fullName: row.fullName,
        valueForPeriodSelected: row.valueForPeriodSelected,
        rowIndex: row.rowIndex,
      });
    }
  }

  batchDetail.batchPayments = batchPayments;
  batchDetail.batchExceptions = batchExceptions;
  await batchDetail.save();

  return {
    paymentsCount: batchPayments.length,
    exceptionsCount: batchExceptions.length,
    payments: batchDetail.batchPayments,
    exceptions: batchDetail.batchExceptions,
    message: `Processed ${rows.length} rows: ${batchPayments.length} matched, ${batchExceptions.length} exceptions.`,
  };
}

module.exports = {
  processBatchDetail,
  processBatchDetailWithBuffer,
  parseRows,
};

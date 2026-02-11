const XLSX = require("xlsx");
const BatchDetail = require("../models/batch.detail.model");
const Profile = require("../models/profile.model");
const azureBlob = require("./azure.blob.service");

/**
 * Default Excel column indices (0-based): A=Membership No, B=Last name, C=First name, D=Full name, E=Value for Periods Selected.
 * If the first row looks like a header (e.g. contains "membership"), we detect column indices from it.
 */
const DEFAULT_COL = {
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

/** Find column index where header (lowercased) includes one of the keywords. */
function findColumnIndex(headerRow, keywords) {
  if (!Array.isArray(headerRow)) return -1;
  for (let c = 0; c < headerRow.length; c++) {
    const cell = String(headerRow[c] || "").trim().toLowerCase();
    if (keywords.some((kw) => cell.includes(kw))) return c;
  }
  return -1;
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
  const headerRow = rows[0];
  let membershipCol = DEFAULT_COL.MEMBERSHIP_NO;
  let lastCol = DEFAULT_COL.LAST_NAME;
  let firstCol = DEFAULT_COL.FIRST_NAME;
  let fullNameCol = DEFAULT_COL.FULL_NAME;
  let valueCol = DEFAULT_COL.VALUE_FOR_PERIOD;
  const membershipHeader = findColumnIndex(headerRow, ["membership", "member no", "member no.", "membership no", "membership no."]);
  if (membershipHeader >= 0) {
    membershipCol = membershipHeader;
    const lastIdx = findColumnIndex(headerRow, ["last name", "surname", "lastname"]);
    const firstIdx = findColumnIndex(headerRow, ["first name", "forename", "firstname"]);
    const fullIdx = findColumnIndex(headerRow, ["full name", "fullname", "name"]);
    const valueIdx = findColumnIndex(headerRow, ["value", "amount", "period"]);
    if (lastIdx >= 0) lastCol = lastIdx;
    if (firstIdx >= 0) firstCol = firstIdx;
    if (fullIdx >= 0) fullNameCol = fullIdx;
    if (valueIdx >= 0) valueCol = valueIdx;
  }
  const dataRows = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const membershipNo = getCell(row, membershipCol);
    if (!membershipNo) continue; // skip empty rows
    dataRows.push({
      rowIndex: i + 1,
      membershipNumber: membershipNo,
      lastName: getCell(row, lastCol),
      firstName: getCell(row, firstCol),
      fullName: getCell(row, fullNameCol),
      valueForPeriodSelected: (() => {
        const v = row[valueCol];
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

  /** Convert Euro to cents: multiply by 100 when value is present and valid. */
  function toCents(euroVal) {
    if (euroVal == null || euroVal === "" || !Number.isFinite(Number(euroVal))) return null;
    const n = Number(euroVal);
    return n * 100;
  }

  /** Returns true if value is null, 0, or not present - row should go to exceptions when profile is matched. */
  function isValueMissingOrZero(val) {
    return val == null || val === "" || Number(val) === 0;
  }

  const batchPayments = [];
  const batchExceptions = [];
  for (const row of rows) {
    const normalizedMembership = String(row.membershipNumber).trim();
    const profile = profileByMembership.get(normalizedMembership);
    const valueMissingOrZero = isValueMissingOrZero(row.valueForPeriodSelected);
    const valueInCents = toCents(row.valueForPeriodSelected);

    // Matched profile with missing/zero value → exception (per requirement)
    if (profile && valueMissingOrZero) {
      batchExceptions.push({
        profileId: profile._id,
        membershipNumber: row.membershipNumber,
        lastName: row.lastName,
        firstName: row.firstName,
        fullName: row.fullName,
        valueForPeriodSelected: null,
        rowIndex: row.rowIndex,
      });
      continue;
    }

    if (profile) {
      const pi = profile.personalInfo || {};
      const ci = profile.contactInfo || {};
      const pd = profile.professionalDetails || {};
      const pref = profile.preferences || {};
      batchPayments.push({
        profileId: profile._id,
        membershipNumber: profile.membershipNumber || row.membershipNumber,
        valueForPeriodSelected: valueInCents,
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
        fileRow: {
          membershipNumber: row.membershipNumber,
          lastName: row.lastName,
          firstName: row.firstName,
          fullName: row.fullName,
          valueForPeriodSelected: valueInCents,
          rowIndex: row.rowIndex,
        },
      });
    } else {
      batchExceptions.push({
        membershipNumber: row.membershipNumber,
        lastName: row.lastName,
        firstName: row.firstName,
        fullName: row.fullName,
        valueForPeriodSelected: valueInCents,
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
  console.log("[BatchDetail] processBatchDetailWithBuffer: parsed file", {
    batchDetailId: batchDetail._id?.toString(),
    rowsCount: rows.length,
    tenantId: tenantId ?? "none",
    membershipNumbersSample: rows.slice(0, 5).map((r) => r.membershipNumber),
  });

  if (rows.length === 0) {
    batchDetail.batchPayments = [];
    batchDetail.batchExceptions = [];
    await batchDetail.save();
    console.log("[BatchDetail] processBatchDetailWithBuffer: no data rows, saved empty arrays");
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
  console.log("[BatchDetail] processBatchDetailWithBuffer: profile lookup", {
    uniqueMembershipNumbers: membershipNumbers.length,
    profilesFound: profiles.length,
  });

  /** Convert Euro to cents: multiply by 100 when value is present and valid. */
  function toCents(euroVal) {
    if (euroVal == null || euroVal === "" || !Number.isFinite(Number(euroVal))) return null;
    const n = Number(euroVal);
    return n * 100;
  }

  /** Returns true if value is null, 0, or not present - row should go to exceptions when profile is matched. */
  function isValueMissingOrZero(val) {
    return val == null || val === "" || Number(val) === 0;
  }

  const batchPayments = [];
  const batchExceptions = [];
  for (const row of rows) {
    const normalizedMembership = String(row.membershipNumber).trim();
    const profile = profileByMembership.get(normalizedMembership);
    const valueMissingOrZero = isValueMissingOrZero(row.valueForPeriodSelected);
    const valueInCents = toCents(row.valueForPeriodSelected);

    // Matched profile with missing/zero value → exception (per requirement)
    if (profile && valueMissingOrZero) {
      batchExceptions.push({
        profileId: profile._id,
        membershipNumber: row.membershipNumber,
        lastName: row.lastName,
        firstName: row.firstName,
        fullName: row.fullName,
        valueForPeriodSelected: null,
        rowIndex: row.rowIndex,
      });
      continue;
    }

    if (profile) {
      const pi = profile.personalInfo || {};
      const ci = profile.contactInfo || {};
      const pd = profile.professionalDetails || {};
      const pref = profile.preferences || {};
      batchPayments.push({
        profileId: profile._id,
        membershipNumber: profile.membershipNumber || row.membershipNumber,
        valueForPeriodSelected: valueInCents,
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
        fileRow: {
          membershipNumber: row.membershipNumber,
          lastName: row.lastName,
          firstName: row.firstName,
          fullName: row.fullName,
          valueForPeriodSelected: valueInCents,
          rowIndex: row.rowIndex,
        },
      });
    } else {
      batchExceptions.push({
        membershipNumber: row.membershipNumber,
        lastName: row.lastName,
        firstName: row.firstName,
        fullName: row.fullName,
        valueForPeriodSelected: valueInCents,
        rowIndex: row.rowIndex,
      });
    }
  }

  batchDetail.batchPayments = batchPayments;
  batchDetail.batchExceptions = batchExceptions;
  await batchDetail.save();

  console.log("[BatchDetail] processBatchDetailWithBuffer: done", {
    batchDetailId: batchDetail._id?.toString(),
    paymentsCount: batchPayments.length,
    exceptionsCount: batchExceptions.length,
    message: `Processed ${rows.length} rows: ${batchPayments.length} matched, ${batchExceptions.length} exceptions.`,
  });
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

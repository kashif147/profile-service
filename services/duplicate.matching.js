const { similarityPercent, weightedNamePoints } = require("../helpers/stringSimilarity.js");

const FUZZY_WEIGHTS = {
  dateOfBirth: 35,
  surname: 25,
  eircode: 20,
  forename: 10,
  addressLine1: 10,
};

const EXACT_FIELD_LABELS = {
  email: "Email",
  mobile: "Mobile",
  nmbiNumber: "NMBI No",
  previousMembershipNo: "Previous Membership No",
  payrollNo: "Payroll No",
};

function normalizeEmail(email) {
  if (!email) return null;
  return String(email).toLowerCase().trim();
}

function normalizePhoneNumber(phone) {
  if (!phone) return null;
  return String(phone).replace(/[\s\-()]/g, "");
}

function normalizeString(str) {
  if (str == null || str === "") return null;
  return String(str).toLowerCase().trim();
}

function normalizeIdentifier(str) {
  if (str == null || str === "") return null;
  return String(str).trim().toUpperCase();
}

function compareDates(date1, date2) {
  if (!date1 || !date2) return false;
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function getAddressLine1(contactInfo = {}) {
  return contactInfo.buildingOrHouse || contactInfo.streetOrRoad || null;
}

function getPrimaryEmail(contactInfo = {}) {
  return contactInfo.personalEmail || contactInfo.workEmail || null;
}

function buildMatchableRecord({
  personalInfo = {},
  contactInfo = {},
  professionalDetails = {},
  subscriptionDetails = {},
  applicationId = null,
  membershipNumber = null,
  membershipCategory = null,
  profileId = null,
}) {
  const forename = normalizeString(personalInfo.forename);
  const surname = normalizeString(personalInfo.surname);
  const fullName = [personalInfo.forename, personalInfo.surname]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    applicationId,
    profileId: profileId ? String(profileId) : null,
    membershipNumber: membershipNumber || null,
    membershipCategory: membershipCategory || null,
    name: fullName || null,
    email: normalizeEmail(getPrimaryEmail(contactInfo)),
    mobile: normalizePhoneNumber(contactInfo.mobileNumber),
    nmbiNumber: normalizeIdentifier(professionalDetails.nmbiNumber),
    previousMembershipNo: normalizeIdentifier(
      subscriptionDetails.previousMembershipNo,
    ),
    payrollNo: normalizeIdentifier(
      subscriptionDetails.payrollNo || professionalDetails.payrollNo,
    ),
    forename,
    surname,
    dateOfBirth: personalInfo.dateOfBirth || null,
    eircode: normalizeString(contactInfo.eircode),
    addressLine1: normalizeString(getAddressLine1(contactInfo)),
  };
}

function classifyScore(score) {
  if (score >= 100) return "Exact Duplicate";
  if (score >= 80) return "Strong Match";
  if (score >= 60) return "Possible Match";
  if (score >= 40) return "Weak Match";
  return "Ignore";
}

function checkExactMatch(source, target) {
  const matchedFields = [];

  if (source.email && target.email && source.email === target.email) {
    matchedFields.push(EXACT_FIELD_LABELS.email);
  }
  if (source.mobile && target.mobile && source.mobile === target.mobile) {
    matchedFields.push(EXACT_FIELD_LABELS.mobile);
  }
  if (
    source.nmbiNumber &&
    target.nmbiNumber &&
    source.nmbiNumber === target.nmbiNumber
  ) {
    matchedFields.push(EXACT_FIELD_LABELS.nmbiNumber);
  }
  if (
    source.previousMembershipNo &&
    target.previousMembershipNo &&
    source.previousMembershipNo === target.previousMembershipNo
  ) {
    matchedFields.push(EXACT_FIELD_LABELS.previousMembershipNo);
  }
  if (
    source.previousMembershipNo &&
    target.membershipNumber &&
    source.previousMembershipNo ===
      normalizeIdentifier(target.membershipNumber)
  ) {
    if (!matchedFields.includes(EXACT_FIELD_LABELS.previousMembershipNo)) {
      matchedFields.push(EXACT_FIELD_LABELS.previousMembershipNo);
    }
  }
  if (
    source.payrollNo &&
    target.payrollNo &&
    source.payrollNo === target.payrollNo
  ) {
    matchedFields.push(EXACT_FIELD_LABELS.payrollNo);
  }

  if (matchedFields.length === 0) {
    return null;
  }

  return {
    score: 100,
    classification: "Exact Duplicate",
    matchedFields,
    matchReason: `Exact match on ${matchedFields.join(", ")}`,
    isExact: true,
  };
}

function calculateFuzzyScore(source, target) {
  let score = 0;
  const matchedFields = [];

  if (
    source.dateOfBirth &&
    target.dateOfBirth &&
    compareDates(source.dateOfBirth, target.dateOfBirth)
  ) {
    score += FUZZY_WEIGHTS.dateOfBirth;
    matchedFields.push("Date of Birth");
  }

  if (source.surname && target.surname) {
    const surnameSim = similarityPercent(source.surname, target.surname);
    const surnamePoints = weightedNamePoints(FUZZY_WEIGHTS.surname, surnameSim);
    if (surnamePoints > 0) {
      score += surnamePoints;
      matchedFields.push("Surname");
    }
  }

  if (source.eircode && target.eircode && source.eircode === target.eircode) {
    score += FUZZY_WEIGHTS.eircode;
    matchedFields.push("Eircode");
  }

  if (source.forename && target.forename) {
    const forenameSim = similarityPercent(source.forename, target.forename);
    const forenamePoints = weightedNamePoints(
      FUZZY_WEIGHTS.forename,
      forenameSim,
    );
    if (forenamePoints > 0) {
      score += forenamePoints;
      matchedFields.push("Forename");
    }
  }

  if (
    source.addressLine1 &&
    target.addressLine1 &&
    source.addressLine1 === target.addressLine1
  ) {
    score += FUZZY_WEIGHTS.addressLine1;
    matchedFields.push("Address Line 1");
  }

  score = Math.min(score, 100);

  if (score < 40) {
    return null;
  }

  return {
    score,
    classification: classifyScore(score),
    matchedFields,
    matchReason: `Fuzzy match on ${matchedFields.join(", ")}`,
    isExact: false,
  };
}

function scorePair(source, target) {
  const exact = checkExactMatch(source, target);
  if (exact) return exact;
  return calculateFuzzyScore(source, target);
}

function toMatchSummaryEntry(sourceType, record, matchResult) {
  return {
    sourceType,
    sourceId:
      sourceType === "PROFILE" ? record.profileId : record.applicationId,
    score: matchResult.score,
    classification: matchResult.classification,
    matchedFields: matchResult.matchedFields,
    matchReason: matchResult.matchReason,
    isExact: !!matchResult.isExact,
    ignored: false,
    name: record.name,
    email: record.email,
    mobile: record.mobile,
    membershipNumber: record.membershipNumber,
    membershipCategory: record.membershipCategory,
  };
}

module.exports = {
  FUZZY_WEIGHTS,
  EXACT_FIELD_LABELS,
  normalizeEmail,
  normalizePhoneNumber,
  normalizeString,
  normalizeIdentifier,
  compareDates,
  getAddressLine1,
  buildMatchableRecord,
  classifyScore,
  checkExactMatch,
  calculateFuzzyScore,
  scorePair,
  toMatchSummaryEntry,
};

const mongoose = require("mongoose");
const Profile = require("../models/profile.model.js");
const PersonalDetails = require("../models/personal.details.model.js");
const { AppError } = require("../errors/AppError.js");
const { loadSubmission } = require("./submission.service.js");
const {
  rehydrateProfile,
  personalInfoKeys,
  contactInfoKeys,
  professionalDetailsKeys,
  preferencesKeys,
  cornmarketKeys,
  additionalInformationKeys,
  recruitmentKeys,
} = require("../helpers/profile.transform.js");
const { findAuthorizedProfileMatch } = require("./duplicate.matching.js");

const SECTION_FIELDS_FROM_SUBSCRIPTION = [
  "primarySection",
  "otherPrimarySection",
  "secondarySection",
  "otherSecondarySection",
];

const SUBSCRIPTION_COMPARE_KEYS = [
  "membershipCategory",
  "paymentType",
  "paymentFrequency",
  "payrollNo",
  "membershipMovement",
  "dateJoined",
  "submissionDate",
  "membershipStatus",
  "valueAddedServices",
  "inmoRewards",
  "exclusiveDiscountsAndOffers",
  "incomeProtectionScheme",
  "otherIrishTradeUnion",
  "otherIrishTradeUnionName",
  "otherScheme",
  "recuritedBy",
  "recuritedByMembershipNo",
  "confirmedRecruiterProfileId",
];

const SECTION_LABELS = {
  personalInfo: "Personal",
  contactInfo: "Contact",
  professionalDetails: "Professional",
  subscriptionDetails: "Subscription",
};

function humanizeFieldKey(key) {
  return String(key)
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function formatCompareValue(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function valuesEqual(a, b) {
  const left = formatCompareValue(a);
  const right = formatCompareValue(b);
  if (left == null && right == null) return true;
  return left === right;
}

function getApplicationValue(submission, section, key) {
  return submission?.[section]?.[key];
}

function getProfileValueForPath(profileSections, section, key) {
  if (section === "personalInfo" || section === "contactInfo") {
    return profileSections[section]?.[key];
  }
  if (section === "professionalDetails") {
    return profileSections.professionalDetails?.[key];
  }
  if (section === "subscriptionDetails") {
    if (preferencesKeys.includes(key)) {
      return profileSections.preferences?.[key];
    }
    if (cornmarketKeys.includes(key)) {
      return profileSections.cornMarket?.[key];
    }
    if (additionalInformationKeys.includes(key)) {
      return profileSections.additionalInformation?.[key];
    }
    if (recruitmentKeys.includes(key)) {
      return profileSections.recruitmentDetails?.[key];
    }
    if (SECTION_FIELDS_FROM_SUBSCRIPTION.includes(key)) {
      return profileSections.professionalDetails?.[key];
    }
    if (professionalDetailsKeys.includes(key)) {
      return profileSections.professionalDetails?.[key];
    }
  }
  return null;
}

function buildMergeFieldDefinitions() {
  const fields = [];

  const addSection = (section, keys) => {
    for (const key of keys) {
      fields.push({
        path: `${section}.${key}`,
        section,
        sectionLabel: SECTION_LABELS[section] || section,
        label: humanizeFieldKey(key),
        key,
      });
    }
  };

  addSection("personalInfo", personalInfoKeys);
  addSection("contactInfo", contactInfoKeys);
  addSection("professionalDetails", professionalDetailsKeys);
  addSection("subscriptionDetails", SUBSCRIPTION_COMPARE_KEYS);

  return fields;
}

const MERGE_FIELD_DEFINITIONS = buildMergeFieldDefinitions();

function buildMergeCompareRows(submission, profileDoc) {
  const profileSections = rehydrateProfile(profileDoc);
  const rows = [];

  for (const field of MERGE_FIELD_DEFINITIONS) {
    const applicationValue = getApplicationValue(
      submission,
      field.section,
      field.key,
    );
    const profileValue = getProfileValueForPath(
      profileSections,
      field.section,
      field.key,
    );

    const formattedApplication = formatCompareValue(applicationValue);
    const formattedProfile = formatCompareValue(profileValue);

    if (formattedApplication == null && formattedProfile == null) {
      continue;
    }

    rows.push({
      path: field.path,
      section: field.section,
      sectionLabel: field.sectionLabel,
      label: field.label,
      applicationValue: formattedApplication,
      profileValue: formattedProfile,
      hasConflict: !valuesEqual(applicationValue, profileValue),
      defaultSource:
        formattedApplication != null && formattedProfile == null
          ? "APPLICATION"
          : formattedProfile != null && formattedApplication == null
            ? "PROFILE"
            : "APPLICATION",
    });
  }

  return rows;
}

function normalizeTenantId(tenantId) {
  return String(tenantId || "").trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveProfileForDuplicateMerge(
  applicationId,
  profileId,
  requestTenantId,
) {
  const idStr = String(profileId || "").trim();
  if (!mongoose.Types.ObjectId.isValid(idStr)) {
    throw AppError.badRequest("Invalid profileId");
  }

  const objectId = new mongoose.Types.ObjectId(idStr);
  const normalizedRequestTenantId = normalizeTenantId(requestTenantId);

  const personal = await PersonalDetails.findOne({ applicationId }).lean();
  if (!personal) {
    throw AppError.notFound("Application not found");
  }

  const applicationTenantId = normalizeTenantId(personal.tenantId);
  if (
    normalizedRequestTenantId &&
    applicationTenantId &&
    normalizedRequestTenantId !== applicationTenantId
  ) {
    throw AppError.notFound("Application not found");
  }

  const tenantId = applicationTenantId || normalizedRequestTenantId;
  const matchRow = findAuthorizedProfileMatch(
    personal.duplicateReview?.matchSummary,
    idStr,
  );

  if (!matchRow) {
    throw AppError.notFound(
      "Profile is not an active duplicate match for this application. Refresh duplicate detection and try again.",
    );
  }

  const findForTenant = (filter) =>
    Profile.findOne({ ...filter, tenantId }).lean();

  let profile = await findForTenant({ _id: objectId });

  if (!profile) {
    profile = await findForTenant({ userId: objectId });
  }

  if (!profile && matchRow.membershipNumber) {
    profile = await Profile.findOne({
      tenantId,
      membershipNumber: new RegExp(
        `^${escapeRegex(matchRow.membershipNumber)}$`,
        "i",
      ),
    }).lean();
  }

  if (!profile) {
    throw AppError.notFound(
      "Profile not found for merge comparison. Run duplicate detection again to refresh matches.",
    );
  }

  return { personal, profile, matchRow };
}

async function getDuplicateMergeCompare(applicationId, profileId, tenantId) {
  const [{ submission }, { profile }] = await Promise.all([
    loadSubmission(applicationId),
    resolveProfileForDuplicateMerge(applicationId, profileId, tenantId),
  ]);

  const fields = buildMergeCompareRows(submission, profile);

  return {
    applicationId,
    profileId: String(profileId),
    profileMembershipNumber: profile.membershipNumber || null,
    profileName:
      profile.personalInfo?.fullName ||
      [profile.personalInfo?.forename, profile.personalInfo?.surname]
        .filter(Boolean)
        .join(" ") ||
      null,
    applicationName:
      [submission.personalInfo?.forename, submission.personalInfo?.surname]
        .filter(Boolean)
        .join(" ") || null,
    fields,
  };
}

function setNestedValue(target, section, key, value) {
  if (!target[section]) target[section] = {};
  if (value === undefined) return;
  target[section][key] = value;
}

function buildEffectiveFromMergeChoices(effective, profileDoc, mergeFieldChoices = {}) {
  const profileSections = rehydrateProfile(profileDoc);
  const merged = {
    personalInfo: {},
    contactInfo: {},
    professionalDetails: {},
    subscriptionDetails: { ...(effective.subscriptionDetails || {}) },
    preferences: {},
    cornMarket: {},
    additionalInformation: {},
    recruitmentDetails: {},
    userId: effective.userId,
    userType: effective.userType,
  };

  for (const field of MERGE_FIELD_DEFINITIONS) {
    const choice = mergeFieldChoices[field.path];
    const applicationValue = getApplicationValue(
      effective,
      field.section,
      field.key,
    );
    const profileValue = getProfileValueForPath(
      profileSections,
      field.section,
      field.key,
    );

    const source =
      choice === "PROFILE" || choice === "APPLICATION"
        ? choice
        : applicationValue != null && profileValue == null
          ? "APPLICATION"
          : profileValue != null && applicationValue == null
            ? "PROFILE"
            : "APPLICATION";

    const value = source === "PROFILE" ? profileValue : applicationValue;
    if (value === undefined) continue;

    if (
      field.section === "personalInfo" ||
      field.section === "contactInfo" ||
      field.section === "professionalDetails"
    ) {
      setNestedValue(merged, field.section, field.key, value);
    } else if (field.section === "subscriptionDetails") {
      setNestedValue(merged, "subscriptionDetails", field.key, value);
    }
  }

  return {
    ...effective,
    personalInfo: { ...effective.personalInfo, ...merged.personalInfo },
    contactInfo: { ...effective.contactInfo, ...merged.contactInfo },
    professionalDetails: {
      ...effective.professionalDetails,
      ...merged.professionalDetails,
    },
    subscriptionDetails: {
      ...effective.subscriptionDetails,
      ...merged.subscriptionDetails,
    },
  };
}

function validateMergeFieldChoices(mergeFieldChoices) {
  if (!mergeFieldChoices || typeof mergeFieldChoices !== "object") {
    throw AppError.badRequest("mergeFieldChoices is required for merge review");
  }

  const entries = Object.entries(mergeFieldChoices);
  if (entries.length === 0) {
    throw AppError.badRequest("Select at least one field preference for merge");
  }

  for (const [path, source] of entries) {
    if (!MERGE_FIELD_DEFINITIONS.some((field) => field.path === path)) {
      throw AppError.badRequest(`Unknown merge field path: ${path}`);
    }
    if (source !== "APPLICATION" && source !== "PROFILE") {
      throw AppError.badRequest(
        `Invalid merge source for ${path}. Use APPLICATION or PROFILE`,
      );
    }
  }
}

module.exports = {
  MERGE_FIELD_DEFINITIONS,
  buildMergeCompareRows,
  resolveProfileForDuplicateMerge,
  getDuplicateMergeCompare,
  buildEffectiveFromMergeChoices,
  validateMergeFieldChoices,
};

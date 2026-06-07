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
const {
  fetchCurrentSubscriptionByProfileId,
} = require("./subscription.service.client.js");

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
  "subscriptionStatus",
  "startDate",
  "endDate",
  "subscriptionYear",
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

const LIVE_SUBSCRIPTION_FIELD_KEYS = new Set([
  "membershipCategory",
  "paymentType",
  "paymentFrequency",
  "payrollNo",
  "membershipMovement",
  "subscriptionStatus",
  "startDate",
  "endDate",
  "subscriptionYear",
]);

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
  if (section === "subscriptionDetails" && key === "startDate") {
    return submission?.subscriptionDetails?.dateJoined ?? null;
  }
  if (section === "subscriptionDetails" && key === "subscriptionYear") {
    const dateJoined = submission?.subscriptionDetails?.dateJoined;
    if (!dateJoined) return null;
    const year = new Date(dateJoined).getUTCFullYear();
    return Number.isNaN(year) ? null : year;
  }
  return submission?.[section]?.[key];
}

function getLiveSubscriptionValue(liveSubscription, key) {
  if (!liveSubscription) return null;
  return liveSubscription[key] ?? null;
}

function getProfileValueForPath(profileSections, section, key, liveSubscription = null) {
  if (section === "subscriptionDetails" && LIVE_SUBSCRIPTION_FIELD_KEYS.has(key)) {
    const liveValue = getLiveSubscriptionValue(liveSubscription, key);
    if (liveValue != null && liveValue !== "") {
      return liveValue;
    }
  }
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

function summarizeActiveSubscription(liveSubscription) {
  if (!liveSubscription) return null;
  return {
    subscriptionId: liveSubscription._id
      ? String(liveSubscription._id)
      : null,
    isCurrent: liveSubscription.isCurrent ?? null,
    subscriptionStatus: liveSubscription.subscriptionStatus ?? null,
    membershipCategory: liveSubscription.membershipCategory ?? null,
    paymentType: liveSubscription.paymentType ?? null,
    paymentFrequency: liveSubscription.paymentFrequency ?? null,
    payrollNo: liveSubscription.payrollNo ?? null,
    startDate: formatCompareValue(liveSubscription.startDate),
    endDate: formatCompareValue(liveSubscription.endDate),
    subscriptionYear: liveSubscription.subscriptionYear ?? null,
    membershipMovement: liveSubscription.membershipMovement ?? null,
  };
}

function buildMergeCompareRows(submission, profileDoc, liveSubscription = null) {
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
      liveSubscription,
    );

    const formattedApplication = formatCompareValue(applicationValue);
    const formattedProfile = formatCompareValue(profileValue);

    if (formattedApplication == null && formattedProfile == null) {
      continue;
    }

    const profileValueFromSubscription =
      field.section === "subscriptionDetails" &&
      LIVE_SUBSCRIPTION_FIELD_KEYS.has(field.key) &&
      liveSubscription != null;

    rows.push({
      path: field.path,
      section: field.section,
      sectionLabel: field.sectionLabel,
      label: field.label,
      applicationValue: formattedApplication,
      profileValue: formattedProfile,
      profileValueFromSubscription,
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
  { requireAuthorizedMatch = true } = {},
) {
  const idStr = String(profileId || "").trim();
  if (!idStr) {
    throw AppError.badRequest("profileId is required");
  }

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

  const matchRowForLookup =
    matchRow ||
    personal.duplicateReview?.matchSummary?.find(
      (m) =>
        m.sourceType === "PROFILE" &&
        (String(m.sourceId) === idStr ||
          (m.membershipNumber &&
            String(m.membershipNumber).toLowerCase() === idStr.toLowerCase())),
    );

  if (requireAuthorizedMatch && !matchRow && !matchRowForLookup) {
    throw AppError.notFound(
      "Profile is not an active duplicate match for this application. Refresh duplicate detection and try again.",
    );
  }

  const findForTenant = (filter) =>
    Profile.findOne({ ...filter, tenantId }).lean();

  let profile = null;

  if (mongoose.Types.ObjectId.isValid(idStr)) {
    const objectId = new mongoose.Types.ObjectId(idStr);
    profile = await findForTenant({ _id: objectId });
    if (!profile) {
      profile = await findForTenant({ userId: objectId });
    }
  }

  if (!profile && matchRowForLookup?.membershipNumber) {
    profile = await Profile.findOne({
      tenantId,
      membershipNumber: new RegExp(
        `^${escapeRegex(matchRowForLookup.membershipNumber)}$`,
        "i",
      ),
    }).lean();
  }

  if (!profile && !mongoose.Types.ObjectId.isValid(idStr)) {
    profile = await Profile.findOne({
      tenantId,
      membershipNumber: new RegExp(`^${escapeRegex(idStr)}$`, "i"),
    }).lean();
  }

  if (!profile) {
    throw AppError.notFound(
      "Profile not found for merge comparison. Run duplicate detection again to refresh matches.",
    );
  }

  return { personal, profile, matchRow: matchRowForLookup };
}

async function fetchLiveSubscriptionForProfile(profile, tenantId) {
  if (!profile?._id) return null;
  return fetchCurrentSubscriptionByProfileId(
    String(profile._id),
    tenantId,
    null,
    profile.currentSubscriptionId,
  );
}

async function getDuplicateMergeCompare(applicationId, profileId, tenantId) {
  const [{ submission }, { profile }] = await Promise.all([
    loadSubmission(applicationId),
    resolveProfileForDuplicateMerge(applicationId, profileId, tenantId),
  ]);

  const liveSubscription = await fetchLiveSubscriptionForProfile(
    profile,
    tenantId,
  );
  const fields = buildMergeCompareRows(submission, profile, liveSubscription);

  return {
    applicationId,
    profileId: String(profile._id),
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
    applicationSummary: {
      name:
        [submission.personalInfo?.forename, submission.personalInfo?.surname]
          .filter(Boolean)
          .join(" ") || null,
      email:
        submission.contactInfo?.personalEmail ||
        submission.contactInfo?.workEmail ||
        null,
      mobile: submission.contactInfo?.mobileNumber || null,
      membershipCategory:
        submission.subscriptionDetails?.membershipCategory || null,
      paymentType: submission.subscriptionDetails?.paymentType || null,
    },
    profileSummary: {
      name:
        profile.personalInfo?.fullName ||
        [profile.personalInfo?.forename, profile.personalInfo?.surname]
          .filter(Boolean)
          .join(" ") ||
        null,
      email:
        profile.contactInfo?.personalEmail ||
        profile.contactInfo?.workEmail ||
        null,
      mobile: profile.contactInfo?.mobileNumber || null,
      membershipNumber: profile.membershipNumber || null,
    },
    activeSubscription: summarizeActiveSubscription(liveSubscription),
    fields,
  };
}

function setNestedValue(target, section, key, value) {
  if (!target[section]) target[section] = {};
  if (value === undefined) return;
  target[section][key] = value;
}

function applySubscriptionChoiceToEffective(effective, key, value) {
  if (value === undefined) return;
  if (key === "startDate") {
    effective.subscriptionDetails = {
      ...(effective.subscriptionDetails || {}),
      dateJoined: value,
    };
    return;
  }
  if (key === "subscriptionYear") {
    return;
  }
  effective.subscriptionDetails = {
    ...(effective.subscriptionDetails || {}),
    [key]: value,
  };
}

function buildEffectiveFromMergeChoices(
  effective,
  profileDoc,
  mergeFieldChoices = {},
  liveSubscription = null,
) {
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
      liveSubscription,
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

  const mergedEffective = {
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

  for (const field of MERGE_FIELD_DEFINITIONS) {
    if (field.section !== "subscriptionDetails") continue;
    const choice = mergeFieldChoices[field.path];
    if (choice !== "PROFILE") continue;
    const profileValue = getProfileValueForPath(
      profileSections,
      field.section,
      field.key,
      liveSubscription,
    );
    applySubscriptionChoiceToEffective(
      mergedEffective,
      field.key,
      profileValue,
    );
  }

  return mergedEffective;
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
  fetchLiveSubscriptionForProfile,
  getDuplicateMergeCompare,
  buildEffectiveFromMergeChoices,
  validateMergeFieldChoices,
};

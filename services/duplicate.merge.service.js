const mongoose = require("mongoose");
const Profile = require("../models/profile.model.js");
const PersonalDetails = require("../models/personal.details.model.js");
const ProfessionalDetails = require("../models/professional.details.model.js");
const SubscriptionDetails = require("../models/subscription.model.js");
const { AppError } = require("../errors/AppError.js");
const { loadSubmission } = require("./submission.service.js");
const {
  rehydrateProfile,
  contactInfoKeys,
  professionalDetailsKeys,
  preferencesKeys,
  cornmarketKeys,
  additionalInformationKeys,
  recruitmentKeys,
} = require("../helpers/profile.transform.js");
const { findAuthorizedProfileMatch } = require("./duplicate.matching.js");
const {
  pickPrimaryEmail,
  normalizeEmail,
} = require("./profileLookup.service.js");
const { flattenProfilePayload } = require("../helpers/profile.transform.js");
const {
  fetchCurrentSubscriptionByProfileId,
} = require("./subscription.service.client.js");
const { fetchMemberFinanceSummary } = require("./account.service.client.js");
const {
  consolidateProfileMergeHistory,
  reassignProfileServiceReferences,
} = require("./profile.merge.consolidation.service.js");
const SECTION_FIELDS_FROM_SUBSCRIPTION = [
  "primarySection",
  "otherPrimarySection",
  "secondarySection",
  "otherSecondarySection",
];

const MERGE_PERSONAL_INFO_KEYS = [
  "title",
  "forename",
  "surname",
  "gender",
  "dateOfBirth",
  "age",
  "countryPrimaryQualification",
  "deceased",
  "deceasedDate",
];

const MERGE_PROFESSIONAL_DETAILS_KEYS = professionalDetailsKeys.filter(
  (key) => key !== "startDate",
);

const MERGE_PROFESSIONAL_TAIL_KEYS = [
  "valueAddedServices",
  "inmoRewards",
  "exclusiveDiscountsAndOffers",
  "incomeProtectionScheme",
  "otherIrishTradeUnion",
  "otherScheme",
];

const SUBSCRIPTION_COMPARE_KEYS = [
  "membershipNo",
  "subscriptionYear",
  "subscriptionStatus",
  "membershipCategory",
  "startDate",
  "endDate",
  "paymentType",
  "paymentFrequency",
];

const DISPLAY_ONLY_COMPARE_KEYS = new Set(["membershipNo"]);

const MERGE_SECTION_LABELS = {
  personal: "Personal",
  professional: "Professional",
  subscription: "Subscription",
};

const FIELD_LABEL_OVERRIDES = {
  "subscriptionDetails.membershipNo": "Membership No",
  "subscriptionDetails.startDate": "Start Date",
  "subscriptionDetails.endDate": "End Date",
  "subscriptionDetails.paymentType": "Payment Method",
  "subscriptionDetails.otherIrishTradeUnion": "Other Irish Trade Union",
};

const LIVE_SUBSCRIPTION_FIELD_KEYS = new Set([
  "membershipCategory",
  "paymentType",
  "paymentFrequency",
  "payrollNo",
  "subscriptionStatus",
  "startDate",
  "endDate",
  "subscriptionYear",
]);

function mergeSectionGroupFor(section) {
  if (section === "personalInfo" || section === "contactInfo") return "personal";
  if (section === "professionalDetails") return "professional";
  return "subscription";
}

function humanizeFieldKey(key) {
  return String(key)
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

const DATE_COMPARE_FIELD_KEYS = new Set([
  "dateOfBirth",
  "dateJoined",
  "submissionDate",
  "startDate",
  "endDate",
  "retiredDate",
  "graduationDate",
  "deceasedDate",
]);

function formatDateDmy(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const day = String(value.getUTCDate()).padStart(2, "0");
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const year = value.getUTCFullYear();
    return `${day}/${month}/${year}`;
  }
  const raw = String(value).trim();
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }
  const dmyMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmyMatch) return raw;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const day = String(parsed.getUTCDate()).padStart(2, "0");
    const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
    const year = parsed.getUTCFullYear();
    return `${day}/${month}/${year}`;
  }
  return raw;
}

function formatCompareValue(value, fieldKey = null) {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (fieldKey && DATE_COMPARE_FIELD_KEYS.has(fieldKey)) {
    return formatDateDmy(value);
  }
  if (value instanceof Date) return formatDateDmy(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return formatDateDmy(value);
  }
  return String(value);
}

function valuesEqual(a, b, fieldKey = null) {
  const left = formatCompareValue(a, fieldKey);
  const right = formatCompareValue(b, fieldKey);
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
}

function getApplicationValue(submission, section, key) {
  if (section === "subscriptionDetails" && key === "startDate") {
    return submission?.subscriptionDetails?.dateJoined ?? null;
  }
  if (section === "subscriptionDetails" && key === "subscriptionYear") {
    const storedYear = submission?.subscriptionDetails?.subscriptionYear;
    if (storedYear != null && storedYear !== "") {
      return storedYear;
    }
    const dateJoined = submission?.subscriptionDetails?.dateJoined;
    if (!dateJoined) return null;
    const year = new Date(dateJoined).getUTCFullYear();
    return Number.isNaN(year) ? null : year;
  }
  if (section === "professionalDetails" && key === "payrollNo") {
    return (
      submission?.professionalDetails?.payrollNo ??
      submission?.subscriptionDetails?.payrollNo ??
      null
    );
  }
  return submission?.[section]?.[key];
}

/** Compare-view only: membership number row uses different sources per side. */
function getApplicationCompareValue(
  submission,
  section,
  key,
  leftProfileFallbacks = null,
) {
  if (section === "subscriptionDetails" && key === "membershipNo") {
    if (leftProfileFallbacks?.membershipNumber != null) {
      return leftProfileFallbacks.membershipNumber;
    }
    return (
      submission?.professionalDetails?.previousMembershipNo ??
      submission?.subscriptionDetails?.previousMembershipNo ??
      null
    );
  }
  return getApplicationValue(submission, section, key);
}

function profileToSubmissionShape(profile, liveSubscription = null) {
  const sections = rehydrateProfile(profile);
  const subscriptionDetails = {
    membershipCategory: liveSubscription?.membershipCategory ?? null,
    paymentType: liveSubscription?.paymentType ?? null,
    paymentFrequency: liveSubscription?.paymentFrequency ?? null,
    payrollNo:
      liveSubscription?.payrollNo ??
      sections.professionalDetails?.payrollNo ??
      null,
    subscriptionStatus: liveSubscription?.subscriptionStatus ?? null,
    dateJoined: liveSubscription?.startDate ?? null,
    startDate: liveSubscription?.startDate ?? null,
    endDate: liveSubscription?.endDate ?? null,
    subscriptionYear: liveSubscription?.subscriptionYear ?? null,
  };

  for (const key of MERGE_PROFESSIONAL_TAIL_KEYS) {
    if (preferencesKeys.includes(key) && sections.preferences?.[key] != null) {
      subscriptionDetails[key] = sections.preferences[key];
    } else if (cornmarketKeys.includes(key) && sections.cornMarket?.[key] != null) {
      subscriptionDetails[key] = sections.cornMarket[key];
    } else if (
      additionalInformationKeys.includes(key) &&
      sections.additionalInformation?.[key] != null
    ) {
      subscriptionDetails[key] = sections.additionalInformation[key];
    }
  }

  return {
    personalInfo: sections.personalInfo || {},
    contactInfo: sections.contactInfo || {},
    professionalDetails: sections.professionalDetails || {},
    subscriptionDetails,
  };
}

async function loadProfileForTenant(profileId, tenantId) {
  const idStr = String(profileId || "").trim();
  if (!idStr || !mongoose.Types.ObjectId.isValid(idStr)) {
    throw AppError.badRequest("profileId is required");
  }
  const profile = await Profile.findOne({
    _id: new mongoose.Types.ObjectId(idStr),
    tenantId,
  }).lean();
  if (!profile) {
    throw AppError.notFound("Profile not found");
  }
  return profile;
}

function getProfileCompareValue(
  profileSections,
  section,
  key,
  liveSubscription,
  profileFallbacks,
) {
  if (section === "subscriptionDetails" && key === "membershipNo") {
    return profileFallbacks.membershipNumber ?? null;
  }
  return getProfileValueForPath(
    profileSections,
    section,
    key,
    liveSubscription,
    profileFallbacks,
  );
}

function getLiveSubscriptionValue(liveSubscription, key) {
  if (!liveSubscription) return null;
  return liveSubscription[key] ?? null;
}

function getProfileValueForPath(
  profileSections,
  section,
  key,
  liveSubscription = null,
  profileFallbacks = {},
) {
  if (section === "subscriptionDetails" && key === "membershipCategory") {
    const liveValue = getLiveSubscriptionValue(liveSubscription, key);
    if (liveValue != null && liveValue !== "") {
      return liveValue;
    }
    if (
      profileFallbacks.membershipCategory != null &&
      profileFallbacks.membershipCategory !== ""
    ) {
      return profileFallbacks.membershipCategory;
    }
  }

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
    if (key === "payrollNo") {
      const professionalPayroll = profileSections.professionalDetails?.payrollNo;
      if (professionalPayroll != null && professionalPayroll !== "") {
        return professionalPayroll;
      }
      return getLiveSubscriptionValue(liveSubscription, "payrollNo");
    }
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

  const addSection = (section, keys, displaySectionGroup = null) => {
    const sectionGroup = displaySectionGroup || mergeSectionGroupFor(section);
    for (const key of keys) {
      const path = `${section}.${key}`;
      fields.push({
        path,
        section,
        sectionGroup,
        sectionLabel: MERGE_SECTION_LABELS[sectionGroup] || section,
        label: FIELD_LABEL_OVERRIDES[path] || humanizeFieldKey(key),
        key,
        viewOnlyLayout: displaySectionGroup != null,
      });
    }
  };

  addSection("personalInfo", MERGE_PERSONAL_INFO_KEYS);
  addSection("contactInfo", contactInfoKeys);
  addSection("professionalDetails", MERGE_PROFESSIONAL_DETAILS_KEYS);
  addSection("subscriptionDetails", SUBSCRIPTION_COMPARE_KEYS);
  // Shown under Professional in the compare view; paths remain subscriptionDetails.*
  addSection("subscriptionDetails", MERGE_PROFESSIONAL_TAIL_KEYS, "professional");

  return fields;
}

const MERGE_COMPARE_FIELD_DEFINITIONS = buildMergeFieldDefinitions();
const MERGE_FIELD_DEFINITIONS = MERGE_COMPARE_FIELD_DEFINITIONS.filter(
  (field) => !DISPLAY_ONLY_COMPARE_KEYS.has(field.key),
);

function formatEuroFromCents(amount) {
  if (amount == null || amount === "") return null;
  const num = Number(amount);
  if (!Number.isFinite(num)) return null;
  const eur = num / 100;
  return `€${eur.toLocaleString("en-IE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatMemberLedgerBalance(net) {
  const num = Number(net) || 0;
  const isCents = Number.isInteger(num);
  const eur = isCents ? Math.abs(num) / 100 : Math.abs(num);
  const indicator = num > 0 ? " Dr" : num < 0 ? " Cr" : "";
  return `€${eur.toLocaleString("en-IE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}${indicator}`;
}

function buildPaymentDisplayField({
  path,
  label,
  applicationValue = null,
  profileValue = null,
  applicationOnly = false,
  profileOnly = false,
}) {
  return {
    path,
    section: "subscriptionDetails",
    sectionGroup: "subscription",
    sectionLabel: MERGE_SECTION_LABELS.subscription,
    label,
    applicationValue,
    profileValue,
    profileValueFromSubscription: profileOnly,
    hasConflict: false,
    displayOnly: true,
    applicationOnly,
    profileOnly,
    defaultSource: applicationOnly ? "APPLICATION" : "PROFILE",
  };
}

function appendPaymentDisplayFields(rows, memberFinanceSummary) {
  if (!memberFinanceSummary) {
    return rows;
  }

  const lastPaymentDateRaw = memberFinanceSummary?.lastPayment?.date || null;
  const lastPaymentDate = lastPaymentDateRaw
    ? formatCompareValue(lastPaymentDateRaw, "startDate")
    : null;
  const lastPaymentAmount =
    memberFinanceSummary?.lastPayment?.amount != null
      ? formatEuroFromCents(memberFinanceSummary.lastPayment.amount)
      : null;

  rows.push(
    buildPaymentDisplayField({
      path: "paymentInfo.lastPaymentAmount",
      label: "Last Payment Amount",
      profileValue: lastPaymentAmount,
      profileOnly: true,
    }),
  );
  rows.push(
    buildPaymentDisplayField({
      path: "paymentInfo.lastPaymentDate",
      label: "Last Payment Date",
      profileValue: lastPaymentDate,
      profileOnly: true,
    }),
  );
  rows.push(
    buildPaymentDisplayField({
      path: "paymentInfo.balance",
      label: "Balance",
      profileValue: formatMemberLedgerBalance(memberFinanceSummary.net ?? 0),
      profileOnly: true,
    }),
  );

  return rows;
}

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

function buildMergeCompareRows(
  submission,
  profileDoc,
  liveSubscription = null,
  profileFallbacks = {},
  memberFinanceSummary = null,
  options = {},
) {
  const { leftProfileFallbacks = null } = options;
  const profileSections = rehydrateProfile(profileDoc);
  const rows = [];

  for (const field of MERGE_COMPARE_FIELD_DEFINITIONS) {
    const applicationValue = getApplicationCompareValue(
      submission,
      field.section,
      field.key,
      leftProfileFallbacks,
    );
    const profileValue = getProfileCompareValue(
      profileSections,
      field.section,
      field.key,
      liveSubscription,
      profileFallbacks,
    );

    const formattedApplication = formatCompareValue(
      applicationValue,
      field.key,
    );
    const formattedProfile = formatCompareValue(profileValue, field.key);

    if (formattedApplication == null && formattedProfile == null) {
      continue;
    }

    const isDisplayOnly = DISPLAY_ONLY_COMPARE_KEYS.has(field.key);
    const profileValueFromSubscription =
      field.section === "subscriptionDetails" &&
      LIVE_SUBSCRIPTION_FIELD_KEYS.has(field.key) &&
      liveSubscription != null;

    rows.push({
      path: field.path,
      section: field.section,
      sectionGroup: field.sectionGroup,
      sectionLabel: field.sectionLabel,
      label: field.label,
      applicationValue: formattedApplication,
      profileValue: formattedProfile,
      profileValueFromSubscription,
      displayOnly: isDisplayOnly,
      applicationColumnHint:
        field.key === "membershipNo" ? "Previous Membership No" : null,
      hasConflict: isDisplayOnly
        ? false
        : !valuesEqual(applicationValue, profileValue, field.key),
      defaultSource:
        formattedApplication != null && formattedProfile == null
          ? "APPLICATION"
          : formattedProfile != null && formattedApplication == null
            ? "PROFILE"
            : "APPLICATION",
    });
  }

  return appendPaymentDisplayFields(rows, memberFinanceSummary);
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

async function fetchLiveSubscriptionForProfile(profile, tenantId, req = null) {
  if (!profile?._id) return null;
  return fetchCurrentSubscriptionByProfileId(
    String(profile._id),
    tenantId,
    req,
    profile.currentSubscriptionId,
  );
}

async function getDuplicateMergeCompare(
  applicationId,
  profileId,
  tenantId,
  req = null,
) {
  const [{ submission }, { profile, matchRow }] = await Promise.all([
    loadSubmission(applicationId),
    resolveProfileForDuplicateMerge(applicationId, profileId, tenantId),
  ]);

  const [liveSubscription, memberFinanceSummary] = await Promise.all([
    fetchLiveSubscriptionForProfile(profile, tenantId, req),
    profile?.membershipNumber
      ? fetchMemberFinanceSummary(profile.membershipNumber, tenantId, req)
      : Promise.resolve(null),
  ]);

  const profileFallbacks = {
    membershipNumber: profile.membershipNumber ?? null,
    membershipCategory:
      liveSubscription?.membershipCategory ??
      matchRow?.membershipCategory ??
      null,
  };
  const fields = buildMergeCompareRows(
    submission,
    profile,
    liveSubscription,
    profileFallbacks,
    memberFinanceSummary,
  );

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
      {
        membershipCategory: liveSubscription?.membershipCategory ?? null,
      },
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
      {
        membershipCategory: liveSubscription?.membershipCategory ?? null,
      },
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

async function resolveMergedEffectiveForReview({
  applicationId,
  tenantId,
  effective,
  mergeFieldChoices,
  matchedProfileId,
  requireAuthorizedMatch = false,
}) {
  validateMergeFieldChoices(mergeFieldChoices);

  const { profile } = await resolveProfileForDuplicateMerge(
    applicationId,
    matchedProfileId,
    tenantId,
    { requireAuthorizedMatch },
  );
  const liveSubscription = await fetchLiveSubscriptionForProfile(profile, tenantId);
  const mergedEffective = buildEffectiveFromMergeChoices(
    effective,
    profile,
    mergeFieldChoices,
    liveSubscription,
  );

  return { mergedEffective, profile, liveSubscription };
}

async function applyMergedEffectiveToApplication({
  applicationId,
  tenantId,
  effective,
  session = null,
}) {
  const writeOptions = session ? { session } : {};

  await PersonalDetails.updateOne(
    { applicationId },
    {
      $set: {
        personalInfo: effective.personalInfo || {},
        contactInfo: effective.contactInfo || {},
      },
    },
    writeOptions,
  );

  const professionalDetails = { ...(effective.professionalDetails || {}) };
  delete professionalDetails.membershipCategory;

  await ProfessionalDetails.updateOne(
    { applicationId },
    {
      $set: {
        tenantId,
        professionalDetails,
      },
    },
    { upsert: true, ...writeOptions },
  );

  const subscriptionDetails = { ...(effective.subscriptionDetails || {}) };
  await SubscriptionDetails.findOneAndUpdate(
    { applicationId },
    {
      $set: {
        tenantId,
        subscriptionDetails,
      },
    },
    { upsert: true, new: true, runValidators: true, ...writeOptions },
  );
}

async function getProfileDuplicateMergeCompare(
  leftProfileId,
  rightProfileId,
  tenantId,
  req = null,
  options = {},
) {
  const { masterProfileId = leftProfileId } = options;
  if (String(leftProfileId) === String(rightProfileId)) {
    throw AppError.badRequest("Cannot compare a profile with itself");
  }

  const [leftProfile, rightProfile] = await Promise.all([
    loadProfileForTenant(leftProfileId, tenantId),
    loadProfileForTenant(rightProfileId, tenantId),
  ]);

  const [leftSubscription, rightSubscription, rightFinanceSummary] =
    await Promise.all([
      fetchLiveSubscriptionForProfile(leftProfile, tenantId, req),
      fetchLiveSubscriptionForProfile(rightProfile, tenantId, req),
      rightProfile?.membershipNumber
        ? fetchMemberFinanceSummary(
            rightProfile.membershipNumber,
            tenantId,
            req,
          )
        : Promise.resolve(null),
    ]);

  const submission = profileToSubmissionShape(leftProfile, leftSubscription);
  const leftProfileFallbacks = {
    membershipNumber: leftProfile.membershipNumber ?? null,
    membershipCategory: leftSubscription?.membershipCategory ?? null,
  };
  const rightProfileFallbacks = {
    membershipNumber: rightProfile.membershipNumber ?? null,
    membershipCategory:
      rightSubscription?.membershipCategory ?? null,
  };

  const fields = buildMergeCompareRows(
    submission,
    rightProfile,
    rightSubscription,
    rightProfileFallbacks,
    rightFinanceSummary,
    { leftProfileFallbacks },
  );

  return {
    leftProfileId: String(leftProfile._id),
    rightProfileId: String(rightProfile._id),
    masterProfileId: String(masterProfileId),
    absorbedProfileId:
      String(masterProfileId) === String(leftProfile._id)
        ? String(rightProfile._id)
        : String(leftProfile._id),
    compareMode: "PROFILE",
    leftProfileSummary: {
      name:
        leftProfile.personalInfo?.fullName ||
        [leftProfile.personalInfo?.forename, leftProfile.personalInfo?.surname]
          .filter(Boolean)
          .join(" ") ||
        null,
      email:
        leftProfile.contactInfo?.personalEmail ||
        leftProfile.contactInfo?.workEmail ||
        null,
      mobile: leftProfile.contactInfo?.mobileNumber || null,
      membershipNumber: leftProfile.membershipNumber || null,
    },
    rightProfileSummary: {
      name:
        rightProfile.personalInfo?.fullName ||
        [rightProfile.personalInfo?.forename, rightProfile.personalInfo?.surname]
          .filter(Boolean)
          .join(" ") ||
        null,
      email:
        rightProfile.contactInfo?.personalEmail ||
        rightProfile.contactInfo?.workEmail ||
        null,
      mobile: rightProfile.contactInfo?.mobileNumber || null,
      membershipNumber: rightProfile.membershipNumber || null,
    },
    sourceProfileId: String(leftProfile._id),
    targetProfileId: String(rightProfile._id),
    sourceProfileSummary: {
      name:
        leftProfile.personalInfo?.fullName ||
        [leftProfile.personalInfo?.forename, leftProfile.personalInfo?.surname]
          .filter(Boolean)
          .join(" ") ||
        null,
      membershipNumber: leftProfile.membershipNumber || null,
    },
    targetProfileSummary: {
      name:
        rightProfile.personalInfo?.fullName ||
        [rightProfile.personalInfo?.forename, rightProfile.personalInfo?.surname]
          .filter(Boolean)
          .join(" ") ||
        null,
      membershipNumber: rightProfile.membershipNumber || null,
    },
    activeSubscription: summarizeActiveSubscription(rightSubscription),
    fields,
  };
}

async function applyMergedEffectiveToKeeperProfile({
  profileId,
  tenantId,
  effective,
  reviewerId,
  session = null,
}) {
  const flattened = flattenProfilePayload(effective);
  const $set = {
    personalInfo: flattened.personalInfo || {},
    contactInfo: flattened.contactInfo || {},
    professionalDetails: flattened.professionalDetails || {},
    preferences: flattened.preferences || {},
    cornMarket: flattened.cornMarket || {},
    additionalInformation: flattened.additionalInformation || {},
    recruitmentDetails: flattened.recruitmentDetails || {},
  };

  const primaryEmail = pickPrimaryEmail(flattened.contactInfo || {});
  if (primaryEmail) {
    $set.normalizedEmail = normalizeEmail(primaryEmail);
  }

  const writeOptions = session ? { session } : {};
  await Profile.updateOne({ _id: profileId, tenantId }, { $set }, writeOptions);
  return Profile.findOne({ _id: profileId, tenantId }).session(session || null);
}

async function executeProfileDuplicateMerge({
  masterProfileId,
  absorbedProfileId,
  tenantId,
  mergeFieldChoices,
  reviewerId,
  req = null,
}) {
  if (String(masterProfileId) === String(absorbedProfileId)) {
    throw AppError.badRequest("Cannot merge a profile with itself");
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const [masterProfile, absorbedProfile] = await Promise.all([
      loadProfileForTenant(masterProfileId, tenantId),
      loadProfileForTenant(absorbedProfileId, tenantId),
    ]);

    const [masterSubscription, absorbedSubscription] = await Promise.all([
      fetchLiveSubscriptionForProfile(masterProfile, tenantId, req),
      fetchLiveSubscriptionForProfile(absorbedProfile, tenantId, req),
    ]);

    const effective = profileToSubmissionShape(masterProfile, masterSubscription);
    validateMergeFieldChoices(mergeFieldChoices);
    const mergedEffective = buildEffectiveFromMergeChoices(
      effective,
      absorbedProfile,
      mergeFieldChoices,
      absorbedSubscription,
    );

    const updatedProfile = await applyMergedEffectiveToKeeperProfile({
      profileId: masterProfile._id,
      tenantId,
      effective: mergedEffective,
      reviewerId,
      session,
    });

    const localConsolidation = await reassignProfileServiceReferences({
      tenantId,
      masterProfileId: masterProfile._id,
      absorbedProfileId: absorbedProfile._id,
      session,
    });

    await session.commitTransaction();

    const remoteConsolidation = await consolidateProfileMergeHistory({
      tenantId,
      masterProfile,
      absorbedProfile,
      req,
      skipLocal: true,
    });

    return {
      masterProfileId: String(masterProfile._id),
      absorbedProfileId: String(absorbedProfile._id),
      masterMembershipNumber: masterProfile.membershipNumber || null,
      absorbedMembershipNumber: absorbedProfile.membershipNumber || null,
      profile: updatedProfile,
      consolidation: {
        local: localConsolidation,
        ...remoteConsolidation,
      },
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

module.exports = {
  MERGE_FIELD_DEFINITIONS,
  MERGE_COMPARE_FIELD_DEFINITIONS,
  buildMergeCompareRows,
  resolveProfileForDuplicateMerge,
  fetchLiveSubscriptionForProfile,
  getDuplicateMergeCompare,
  buildEffectiveFromMergeChoices,
  validateMergeFieldChoices,
  resolveMergedEffectiveForReview,
  applyMergedEffectiveToApplication,
  getProfileDuplicateMergeCompare,
  executeProfileDuplicateMerge,
  profileToSubmissionShape,
};

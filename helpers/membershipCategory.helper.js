/**
 * membershipCategory is owned by subscription details, but the portal UI still
 * sends it on professional-details create/update. These helpers capture it
 * from the raw body and keep subscription + professional reads in sync for
 * portal flows.
 */

function normalizeMembershipCategory(value) {
  if (value == null || value === "") return null;
  return String(value).trim();
}

function extractMembershipCategoryFromRequestBody(body) {
  return normalizeMembershipCategory(body?.professionalDetails?.membershipCategory);
}

function extractLegacyProfessionalFieldsFromSubscriptionBody(body) {
  const sub = body?.subscriptionDetails || {};
  const legacy = {};
  for (const key of LEGACY_PROFESSIONAL_FIELDS_FROM_SUBSCRIPTION) {
    if (!Object.prototype.hasOwnProperty.call(sub, key)) continue;
    legacy[key] = sub[key];
  }
  return Object.keys(legacy).length > 0 ? legacy : null;
}

function attachMembershipCategoryToProfessionalData(data, membershipCategory) {
  if (!membershipCategory) return data;
  const next = { ...data };
  next.professionalDetails = {
    ...(next.professionalDetails || {}),
    membershipCategory,
  };
  return next;
}

const LEGACY_PROFESSIONAL_FIELDS_FROM_SUBSCRIPTION = [
  "previousMembershipNo",
  "joinYouthForum",
  "youthForum",
];

function mergeLegacyProfessionalFieldsFromSubscription(
  professionalDetails = {},
  legacySubscriptionFields = {},
) {
  const merged = { ...professionalDetails };
  const sub = legacySubscriptionFields || {};
  for (const key of LEGACY_PROFESSIONAL_FIELDS_FROM_SUBSCRIPTION) {
    const prof = merged[key];
    if (prof != null && prof !== "") continue;
    const v = sub[key];
    if (v != null && v !== "") {
      merged[key] = v;
    } else if (typeof v === "boolean" && prof == null) {
      merged[key] = v;
    }
  }
  return merged;
}

async function readLegacyProfessionalFieldsFromSubscriptionRecord(
  subscriptionRecord,
) {
  if (!subscriptionRecord?._id) return {};

  const SubscriptionDetails = require("../models/subscription.model");
  const raw = await SubscriptionDetails.collection.findOne(
    { _id: subscriptionRecord._id },
    {
      projection: {
        "subscriptionDetails.previousMembershipNo": 1,
        "subscriptionDetails.joinYouthForum": 1,
        "subscriptionDetails.youthForum": 1,
      },
    },
  );
  const sub = raw?.subscriptionDetails || {};
  const legacy = {};
  for (const key of LEGACY_PROFESSIONAL_FIELDS_FROM_SUBSCRIPTION) {
    if (sub[key] !== undefined) legacy[key] = sub[key];
  }
  return legacy;
}

function professionalPayloadIncludesMigratedFields(professionalDetails = {}) {
  return LEGACY_PROFESSIONAL_FIELDS_FROM_SUBSCRIPTION.some((key) =>
    Object.prototype.hasOwnProperty.call(professionalDetails, key),
  );
}

async function enrichProfessionalWithSubscriptionMembershipCategory(
  professionalDoc,
  subscriptionDoc,
) {
  if (!professionalDoc) return professionalDoc;

  const plain = professionalDoc.toObject?.() ?? professionalDoc;
  const legacyFields = await readLegacyProfessionalFieldsFromSubscriptionRecord(
    subscriptionDoc,
  );
  const enrichedProfessionalDetails = mergeLegacyProfessionalFieldsFromSubscription(
    plain.professionalDetails || {},
    legacyFields,
  );

  const subscriptionCategory = normalizeMembershipCategory(
    subscriptionDoc?.subscriptionDetails?.membershipCategory,
  );
  const professionalCategory = normalizeMembershipCategory(
    enrichedProfessionalDetails.membershipCategory,
  );
  const membershipCategory = subscriptionCategory || professionalCategory;

  return {
    ...plain,
    professionalDetails: {
      ...enrichedProfessionalDetails,
      ...(membershipCategory ? { membershipCategory } : {}),
    },
  };
}

async function syncMembershipCategoryToSubscription({
  applicationId,
  membershipCategory,
  userId,
  userType,
  tenantId,
  subscriptionDetailsHandler,
}) {
  const category = normalizeMembershipCategory(membershipCategory);
  if (!category || !applicationId) return;

  const existing = await subscriptionDetailsHandler.getByApplicationId(
    applicationId,
    tenantId
  );
  if (!existing) return;

  await subscriptionDetailsHandler.updateByApplicationId(
    applicationId,
    {
      "subscriptionDetails.membershipCategory": category,
      "meta.updatedBy": userId,
      "meta.userType": userType,
    },
    tenantId
  );
}

/**
 * Joi update schemas apply .default(null) to omitted keys. Only merge subscription
 * fields the client actually sent so we do not wipe stored values (e.g. membershipCategory).
 */
function pickRequestedSubscriptionDetails(validatedData, rawBody) {
  if (!validatedData?.subscriptionDetails) return validatedData;

  const rawSub = rawBody?.subscriptionDetails || {};
  const requestedKeys = Object.keys(rawSub);
  if (requestedKeys.length === 0) return validatedData;

  const partial = {};
  for (const key of requestedKeys) {
    if (!Object.prototype.hasOwnProperty.call(rawSub, key)) continue;
    if (
      Object.prototype.hasOwnProperty.call(
        validatedData.subscriptionDetails,
        key
      )
    ) {
      partial[key] = validatedData.subscriptionDetails[key];
    }
  }

  return {
    ...validatedData,
    subscriptionDetails: partial,
  };
}

function subscriptionDetailsToPlain(subDoc) {
  if (!subDoc) return {};
  if (typeof subDoc.toObject === "function") {
    return subDoc.toObject();
  }
  return { ...subDoc };
}

async function syncLegacyProfessionalFieldsFromSubscriptionBody({
  applicationId,
  body,
  userId,
  userType,
  professionalDetailsHandler,
  subscriptionDetailsHandler,
}) {
  const legacyFields = extractLegacyProfessionalFieldsFromSubscriptionBody(body);
  if (!legacyFields || !applicationId) return;

  const existing = await professionalDetailsHandler.getByApplicationId(
    applicationId,
  );
  if (!existing) return;

  const update = {
    "meta.updatedBy": userId,
    "meta.userType": userType,
  };
  for (const [key, value] of Object.entries(legacyFields)) {
    update[`professionalDetails.${key}`] = value;
  }

  await professionalDetailsHandler.updateByApplicationId(applicationId, update);
  await subscriptionDetailsHandler.unsetLegacyProfessionalFieldsByApplicationId(
    applicationId,
  );
}

module.exports = {
  normalizeMembershipCategory,
  extractMembershipCategoryFromRequestBody,
  extractLegacyProfessionalFieldsFromSubscriptionBody,
  syncLegacyProfessionalFieldsFromSubscriptionBody,
  attachMembershipCategoryToProfessionalData,
  LEGACY_PROFESSIONAL_FIELDS_FROM_SUBSCRIPTION,
  mergeLegacyProfessionalFieldsFromSubscription,
  readLegacyProfessionalFieldsFromSubscriptionRecord,
  professionalPayloadIncludesMigratedFields,
  enrichProfessionalWithSubscriptionMembershipCategory,
  syncMembershipCategoryToSubscription,
  pickRequestedSubscriptionDetails,
  subscriptionDetailsToPlain,
};

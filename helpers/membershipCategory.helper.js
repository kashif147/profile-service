/**
 * membershipCategory is owned by subscription details, but the portal UI still
 * sends it on professional-details create/update. Joi strips the field from
 * validated payloads — these helpers capture it from the raw body and keep
 * subscription + professional reads in sync for portal flows.
 */

function normalizeMembershipCategory(value) {
  if (value == null || value === "") return null;
  return String(value).trim();
}

function extractMembershipCategoryFromRequestBody(body) {
  return normalizeMembershipCategory(body?.professionalDetails?.membershipCategory);
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

function enrichProfessionalWithSubscriptionMembershipCategory(
  professionalDoc,
  subscriptionDoc
) {
  if (!professionalDoc) return professionalDoc;

  const subscriptionCategory = normalizeMembershipCategory(
    subscriptionDoc?.subscriptionDetails?.membershipCategory
  );
  const professionalCategory = normalizeMembershipCategory(
    professionalDoc?.professionalDetails?.membershipCategory
  );

  const membershipCategory = subscriptionCategory || professionalCategory;
  if (!membershipCategory) return professionalDoc;

  return {
    ...(professionalDoc.toObject?.() ?? professionalDoc),
    professionalDetails: {
      ...(professionalDoc.professionalDetails || {}),
      membershipCategory,
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

  const requestedKeys = Object.keys(rawBody?.subscriptionDetails || {});
  if (requestedKeys.length === 0) return validatedData;

  const partial = {};
  for (const key of requestedKeys) {
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

module.exports = {
  normalizeMembershipCategory,
  extractMembershipCategoryFromRequestBody,
  attachMembershipCategoryToProfessionalData,
  enrichProfessionalWithSubscriptionMembershipCategory,
  syncMembershipCategoryToSubscription,
  pickRequestedSubscriptionDetails,
};

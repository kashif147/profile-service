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

  const membershipCategory = professionalCategory || subscriptionCategory;
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

module.exports = {
  normalizeMembershipCategory,
  extractMembershipCategoryFromRequestBody,
  attachMembershipCategoryToProfessionalData,
  enrichProfessionalWithSubscriptionMembershipCategory,
  syncMembershipCategoryToSubscription,
};

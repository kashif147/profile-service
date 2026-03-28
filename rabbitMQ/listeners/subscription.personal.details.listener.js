/**
 * Sets personalDetails.meta.isActive when subscription is resigned/cancelled or resignation is undone.
 */
const mongoose = require("mongoose");
const PersonalDetails = require("../../models/personal.details.model.js");

function normalizeSubscriptionEventPayload(payload) {
  const data = payload?.data || payload;
  if (!data || typeof data !== "object") return null;
  return {
    ...data,
    tenantId: data.tenantId ?? payload?.tenantId,
  };
}

async function setPersonalDetailsActiveFromSubscriptionEvent(data, isActive) {
  const { applicationId, profileId, tenantId } = data || {};
  const tid = tenantId != null && String(tenantId).trim() ? String(tenantId) : null;
  if (!tid) {
    console.warn(
      "[subscription.personal.details] Missing tenantId; skip meta.isActive update"
    );
    return;
  }

  const filter = { tenantId: tid };
  if (applicationId != null && String(applicationId).trim()) {
    filter.applicationId = String(applicationId).trim();
  } else if (profileId && mongoose.Types.ObjectId.isValid(profileId)) {
    filter.profileId = new mongoose.Types.ObjectId(profileId);
  } else {
    console.warn(
      "[subscription.personal.details] No applicationId or valid profileId; skip",
      { tenantId: tid }
    );
    return;
  }

  const result = await PersonalDetails.updateOne(filter, {
    $set: { "meta.isActive": isActive },
  });

  if (result.matchedCount === 0) {
    console.warn(
      "[subscription.personal.details] No personalDetails row matched",
      { ...filter, isActive }
    );
  }
}

async function handleSubscriptionResignedInactive(payload) {
  const data = normalizeSubscriptionEventPayload(payload);
  if (!data) return;
  await setPersonalDetailsActiveFromSubscriptionEvent(data, false);
}

async function handleSubscriptionCancelledInactive(payload) {
  const data = normalizeSubscriptionEventPayload(payload);
  if (!data) return;
  await setPersonalDetailsActiveFromSubscriptionEvent(data, false);
}

async function handleSubscriptionResignationUndoneActive(payload) {
  const data = normalizeSubscriptionEventPayload(payload);
  if (!data) return;
  await setPersonalDetailsActiveFromSubscriptionEvent(data, true);
}

module.exports = {
  handleSubscriptionResignedInactive,
  handleSubscriptionCancelledInactive,
  handleSubscriptionResignationUndoneActive,
};

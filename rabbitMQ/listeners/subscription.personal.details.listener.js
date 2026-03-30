/**
 * Sets personalDetails.meta.isActive when subscription is resigned/cancelled or resignation is undone.
 */
const mongoose = require("mongoose");
const PersonalDetails = require("../../models/personal.details.model.js");
const Profile = require("../../models/profile.model.js");

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

async function setProfileActiveFromSubscriptionEvent(data, isActive) {
  const { profileId, tenantId } = data || {};
  const tid = tenantId != null && String(tenantId).trim() ? String(tenantId) : null;

  if (!profileId || !mongoose.Types.ObjectId.isValid(profileId)) {
    console.warn(
      "[subscription.profile] Missing/invalid profileId; skip profile isActive update",
      { tenantId: tid || "(none)" }
    );
    return;
  }

  const filter = { _id: new mongoose.Types.ObjectId(profileId) };
  if (tid) filter.tenantId = tid;

  const update = {
    $set: {
      isActive,
      deactivatedAt: isActive ? null : new Date(),
    },
  };

  const result = await Profile.updateOne(filter, update);
  if (result.matchedCount === 0) {
    console.warn("[subscription.profile] No profile row matched", {
      profileId: String(profileId),
      tenantId: tid || "(none)",
      isActive,
    });
  }
}

async function handleSubscriptionResignedInactive(payload) {
  const data = normalizeSubscriptionEventPayload(payload);
  if (!data) return;
  await setPersonalDetailsActiveFromSubscriptionEvent(data, false);
  await setProfileActiveFromSubscriptionEvent(data, false);
}

async function handleSubscriptionCancelledInactive(payload) {
  const data = normalizeSubscriptionEventPayload(payload);
  if (!data) return;
  await setPersonalDetailsActiveFromSubscriptionEvent(data, false);
  await setProfileActiveFromSubscriptionEvent(data, false);
}

async function handleSubscriptionResignationUndoneActive(payload) {
  const data = normalizeSubscriptionEventPayload(payload);
  if (!data) return;
  await setPersonalDetailsActiveFromSubscriptionEvent(data, true);
  await setProfileActiveFromSubscriptionEvent(data, true);
}

async function handleSubscriptionCancellationUndoneActive(payload) {
  const data = normalizeSubscriptionEventPayload(payload);
  if (!data) return;
  await setPersonalDetailsActiveFromSubscriptionEvent(data, true);
  await setProfileActiveFromSubscriptionEvent(data, true);
}

module.exports = {
  handleSubscriptionResignedInactive,
  handleSubscriptionCancelledInactive,
  handleSubscriptionResignationUndoneActive,
  handleSubscriptionCancellationUndoneActive,
};

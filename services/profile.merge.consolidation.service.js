const mongoose = require("mongoose");
const PersonalDetails = require("../models/personal.details.model.js");
const Profile = require("../models/profile.model.js");
const MemberPaymentForm = require("../models/memberPaymentForm.model.js");
const TransferRequest = require("../models/transfer.request.model.js");
const Batch = require("../models/batch.model.js");
const {
  reassignSubscriptionsForProfileMerge,
} = require("./subscription.service.client.js");
const {
  reassignFinanceForProfileMerge,
} = require("./account.service.client.js");

function toObjectId(value) {
  if (!value) return null;
  const str = String(value);
  return mongoose.Types.ObjectId.isValid(str)
    ? new mongoose.Types.ObjectId(str)
    : null;
}

async function reassignProfileServiceReferences({
  tenantId,
  masterProfileId,
  absorbedProfileId,
  session,
}) {
  const masterObjectId = toObjectId(masterProfileId);
  const absorbedObjectId = toObjectId(absorbedProfileId);
  if (!masterObjectId || !absorbedObjectId) {
    throw new Error("Invalid profile ids for merge consolidation");
  }

  const writeOptions = session ? { session } : {};

  const personalResult = await PersonalDetails.updateMany(
    { profileId: absorbedObjectId },
    { $set: { profileId: masterObjectId } },
    writeOptions,
  );

  const paymentFormResult = await MemberPaymentForm.updateMany(
    { tenantId, profileId: absorbedObjectId },
    { $set: { profileId: masterObjectId } },
    writeOptions,
  );

  const transferResult = await TransferRequest.updateMany(
    { tenantId, profileId: absorbedObjectId },
    { $set: { profileId: masterObjectId } },
    writeOptions,
  );

  const batchProfileIdsResult = await Batch.updateMany(
    { profileIds: absorbedObjectId },
    [
      {
        $set: {
          profileIds: {
            $map: {
              input: "$profileIds",
              as: "pid",
              in: {
                $cond: [
                  { $eq: ["$$pid", absorbedObjectId] },
                  masterObjectId,
                  "$$pid",
                ],
              },
            },
          },
        },
      },
    ],
    writeOptions,
  );

  const batchProfilesResult = await Batch.updateMany(
    { "profiles.profileId": absorbedObjectId },
    [
      {
        $set: {
          profiles: {
            $map: {
              input: "$profiles",
              as: "profile",
              in: {
                $cond: [
                  { $eq: ["$$profile.profileId", absorbedObjectId] },
                  {
                    $mergeObjects: [
                      "$$profile",
                      { profileId: masterObjectId },
                    ],
                  },
                  "$$profile",
                ],
              },
            },
          },
        },
      },
    ],
    writeOptions,
  );

  const recruiterResult = await Profile.updateMany(
    {
      tenantId,
      "recruitmentDetails.confirmedRecruiterProfileId": absorbedObjectId,
    },
    {
      $set: {
        "recruitmentDetails.confirmedRecruiterProfileId": masterObjectId,
      },
    },
    writeOptions,
  );

  await Profile.updateOne(
    { _id: masterObjectId, tenantId },
    { $set: { hasHistory: true } },
    writeOptions,
  );

  await Profile.updateOne(
    { _id: absorbedObjectId, tenantId },
    {
      $set: {
        isActive: false,
        deactivatedAt: new Date(),
        mergedIntoProfileId: masterObjectId,
      },
    },
    writeOptions,
  );

  return {
    applicationsReassigned: personalResult.modifiedCount || 0,
    paymentFormsReassigned: paymentFormResult.modifiedCount || 0,
    transferRequestsReassigned: transferResult.modifiedCount || 0,
    batchProfileIdsUpdated:
      (batchProfileIdsResult.modifiedCount || 0) +
      (batchProfilesResult.modifiedCount || 0),
    recruiterReferencesUpdated: recruiterResult.modifiedCount || 0,
  };
}

async function consolidateProfileMergeHistory({
  tenantId,
  masterProfile,
  absorbedProfile,
  session = null,
  req = null,
  skipLocal = false,
}) {
  const masterProfileId = String(masterProfile._id);
  const absorbedProfileId = String(absorbedProfile._id);
  const masterMembershipNumber = masterProfile.membershipNumber || null;
  const absorbedMembershipNumber = absorbedProfile.membershipNumber || null;

  const local = skipLocal
    ? null
    : await reassignProfileServiceReferences({
        tenantId,
        masterProfileId,
        absorbedProfileId,
        session,
      });

  const subscription = await reassignSubscriptionsForProfileMerge({
    tenantId,
    masterProfileId,
    absorbedProfileId,
    masterMembershipNumber,
    absorbedMembershipNumber,
    req,
  });

  const finance = await reassignFinanceForProfileMerge({
    tenantId,
    masterProfileId,
    absorbedProfileId,
    masterMembershipNumber,
    absorbedMembershipNumber,
    req,
  });

  if (subscription.currentSubscriptionId) {
    const writeOptions = session ? { session } : {};
    await Profile.updateOne(
      { _id: masterProfile._id, tenantId },
      {
        $set: {
          currentSubscriptionId: toObjectId(subscription.currentSubscriptionId),
          hasHistory: true,
        },
      },
      writeOptions,
    );
  }

  return {
    masterProfileId,
    absorbedProfileId,
    masterMembershipNumber,
    absorbedMembershipNumber,
    local,
    subscription,
    finance,
  };
}

module.exports = {
  consolidateProfileMergeHistory,
  reassignProfileServiceReferences,
};

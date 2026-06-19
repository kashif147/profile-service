// services/approval.service.js
const mongoose = require("mongoose");
const jsonPatch = require("fast-json-patch");
const { applyPatch } = jsonPatch;
const crypto = require("crypto");
// Helper function to handle bypass user ObjectId conversion
function getReviewerIdForDb(reviewerId) {
  if (reviewerId === "bypass-user") {
    return null; // Allow null for bypass users
  }
  return reviewerId;
}

function toObjectIdOrNull(value) {
  if (value == null || value === "" || value === "bypass-user") return null;
  const str = String(value).trim();
  return mongoose.Types.ObjectId.isValid(str)
    ? new mongoose.Types.ObjectId(str)
    : null;
}
const ReviewOverlay = require("../models/reviewOverlay.model.js");
const PersonalDetails = require("../models/personal.details.model.js");
const ProfessionalDetails = require("../models/professional.details.model.js");
const SubscriptionDetails = require("../models/subscription.model.js");
const Profile = require("../models/profile.model.js");
const User = require("../models/user.model.js");
const { loadSubmission } = require("./submission.service.js");
const ApplicationApprovalEventPublisher = require("../rabbitMQ/publishers/application.approval.publisher.js");
const { APPLICATION_STATUS } = require("../constants/enums.js");
const { flattenProfilePayload } = require("../helpers/profile.transform.js");
const {
  generateMembershipNumber,
} = require("../helpers/membership.number.generator.js");
const {
  publishPostApprovalEvents,
} = require("./publishPostApprovalEvents.js");
const {
  resolvePortalUserServiceId,
} = require("../helpers/portalUserIdentity.js");
const { publishProfileAudit } = require("./profile.audit.publisher.js");

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

const {
  parseDateOnlyToUtcNoon,
  normalizeSubscriptionDetailsDates,
} = require("../helpers/parseDateOnly.js");
const {
  applyNoFeeMembershipPaymentDefaults,
} = require("../helpers/noFeeMembershipPayment.helper.js");

function normalizeSubscriptionDetails(
  subscriptionDetails = {},
  professional = {}
) {
  const normalized = { ...subscriptionDetails };
  if (
    normalized.membershipCategory == null &&
    professional?.membershipCategory != null
  ) {
    normalized.membershipCategory = professional.membershipCategory;
  }
  if (!normalized.dateJoined) {
    normalized.dateJoined = parseDateOnlyToUtcNoon(null, true);
  }
  return applyNoFeeMembershipPaymentDefaults(
    normalizeSubscriptionDetailsDates(normalized),
  );
}

async function approveApplication({
  applicationId,
  overlayId,
  overlayVersion,
  reviewerId, // ID of the user who is approving this application (the CRM user)
  tenantId,
}) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const personalForStatus = await PersonalDetails.findOne({
      applicationId,
      tenantId: String(tenantId),
    })
      .select("applicationStatus")
      .session(session);

    if (personalForStatus?.applicationStatus === APPLICATION_STATUS.PROCESSED) {
      throw Object.assign(new Error("Application has already been processed."), {
        statusCode: 409,
      });
    }

    // Load submission and overlay
    const { submission } = await loadSubmission(applicationId);
    const overlay = await ReviewOverlay.findOne({
      overlayId,
      applicationId,
      status: "open",
    }).session(session);
    if (!overlay) throw new Error("Open overlay not found");
    if (overlay.overlayVersion !== overlayVersion) {
      throw Object.assign(new Error("Overlay version conflict"), {
        statusCode: 409,
      });
    }

    // Compute effective
    let effective = applyPatch(
      deepClone(submission),
      overlay.proposedPatch
    ).newDocument;
    const normalizedSubscriptionDetails = normalizeSubscriptionDetails(
      effective.subscriptionDetails,
      effective.professionalDetails
    );

    // Log dateJoined for debugging
    console.log("[approveApplication service] dateJoined check:", {
      beforeNormalize: effective.subscriptionDetails?.dateJoined,
      afterNormalize: normalizedSubscriptionDetails?.dateJoined,
      hasDateJoined: !!normalizedSubscriptionDetails?.dateJoined,
    });

    effective = {
      ...effective,
      subscriptionDetails: normalizedSubscriptionDetails,
    };

    const flattenedProfileFields = flattenProfilePayload(effective);

    const effectiveHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(effective))
      .digest("hex");

    // 1) Find existing profile or create new one
    const email =
      effective.contactInfo?.personalEmail || effective.contactInfo?.workEmail;
    if (!email) throw new Error("No email found in effective data");

    const normalizedEmail = email.toLowerCase();
    let existingProfile = await Profile.findOne({
      tenantId,
      normalizedEmail,
    }).session(session);

    // Try to find existing portal user by email to link userId
    const existingUser = await User.findOne({
      tenantId,
      userEmail: normalizedEmail,
      userType: "PORTAL",
      isActive: true,
    }).session(session);

    const portalUserId = existingUser?.userId || null;
    const portalUserDocumentId = existingUser?._id || null;
    const linkedUserDocumentId =
      portalUserDocumentId ||
      (portalUserId ? toObjectIdOrNull(portalUserId) : null);

    if (portalUserId) {
      console.log(
        `✅ Found existing portal user for email ${normalizedEmail}: ${portalUserId}`
      );
    } else {
      console.log(
        `ℹ️ No portal user found for email ${normalizedEmail}, userId will remain null until user is created`
      );
    }

    let profile;
    if (existingProfile) {
      // Update existing profile - keep existing membership number
      const profileUpdate = {
        ...flattenedProfileFields,
      };
      
      // Set crmUserId to the ID of the user who approved this application (reviewerId)
      // Only set if reviewerId is provided (the CRM user who is approving/improving the profile)
      if (reviewerId) {
        profileUpdate.crmUserId = getReviewerIdForDb(reviewerId);
      }

      // Link portal userId if found and not already set
      if (
        linkedUserDocumentId &&
        String(existingProfile.userId || "") !== String(linkedUserDocumentId)
      ) {
        profileUpdate.userId = linkedUserDocumentId;
        console.log(
          `✅ Linking portal user ${portalUserId} to existing profile ${existingProfile._id}`
        );
      }

      if (!existingProfile.membershipNumber) {
        const membershipNumber = await generateMembershipNumber();
        profileUpdate.membershipNumber = membershipNumber;
        console.log(
          `✅ Generated membership number ${membershipNumber} for existing profile ${existingProfile._id}`
        );
      }

      await Profile.updateOne(
        { _id: existingProfile._id },
        { $set: profileUpdate },
        { session }
      );
      profile = existingProfile;
    } else {
      // Create new profile (first-ever membership): set initial fields via upsert
      const now = new Date();
      // Use dateJoined from approval if available, otherwise use current date
      const firstJoinedDate = effective.subscriptionDetails?.dateJoined
        ? parseDateOnlyToUtcNoon(effective.subscriptionDetails.dateJoined, true)
        : parseDateOnlyToUtcNoon(null, true);
      const submissionDate =
        effective.subscriptionDetails?.submissionDate != null
          ? parseDateOnlyToUtcNoon(
              effective.subscriptionDetails.submissionDate,
              false
            )
          : now;

      // Generate membership number for new profile
      const membershipNumber = await generateMembershipNumber();

      // Build $set object for new profile creation
      const profileSetFields = {
        ...flattenedProfileFields,
      };
      
      // Set crmUserId to the ID of the user who approved this application (reviewerId)
      // Only set if reviewerId is provided (the CRM user who is approving/improving the profile)
      if (reviewerId) {
        profileSetFields.crmUserId = getReviewerIdForDb(reviewerId);
      }

      // Link portal userId if found
      if (linkedUserDocumentId) {
        profileSetFields.userId = linkedUserDocumentId;
        console.log(
          `✅ Linking portal user ${portalUserId} to new profile`
        );
      }

      const upsertRes = await Profile.updateOne(
        { tenantId, normalizedEmail },
        {
          $set: profileSetFields,
          $setOnInsert: {
            tenantId,
            normalizedEmail,
            membershipNumber: membershipNumber, // Auto-generated membership number for new profile
            firstJoinedDate: firstJoinedDate,
            submissionDate,
            currentSubscriptionId: null,
            hasHistory: false,
          },
        },
        { upsert: true, session }
      );
      profile = await Profile.findOne({ tenantId, normalizedEmail }).session(
        session
      );
      if (profile) {
        const afterLean = profile.toObject({ depopulate: true });
        if (upsertRes.upsertedCount > 0) {
          await publishProfileAudit("profile.created", {
            tenantId,
            profileId: profile._id,
            before: null,
            after: afterLean,
            actorId: reviewerId,
            source: "approval.service",
          });
        } else {
          await publishProfileAudit("profile.updated", {
            tenantId,
            profileId: profile._id,
            before: null,
            after: afterLean,
            actorId: reviewerId,
            source: "approval.service",
          });
        }
      }
      console.log(
        `✅ Generated membership number ${membershipNumber} for new profile ${profile._id}`
      );
    }

    // 2) Update PersonalDetails with effective personal/contact AND approval metadata
    const personalUpdate = {
      personalInfo: effective.personalInfo ?? null,
      contactInfo: effective.contactInfo ?? null,
      applicationStatus: APPLICATION_STATUS.PROCESSED,
      profileId: profile._id,
      approvalDetails: {
        approvedBy: getReviewerIdForDb(reviewerId),
        approvedAt: new Date(),
        comments: overlay.notes ?? undefined,
      },
    };

    // Link portal userId if found
    if (linkedUserDocumentId) {
      personalUpdate.userId = linkedUserDocumentId;
    }

    await PersonalDetails.updateOne(
      { applicationId: applicationId },
      { $set: personalUpdate }
    ).session(session);

    // 2) Update ProfessionalDetails and SubscriptionDetails from effective
    if (effective.professionalDetails) {
      const professionalUpdate = {
        professionalDetails: effective.professionalDetails,
      };

      // Link portal userId if found
      if (linkedUserDocumentId) {
        professionalUpdate.userId = linkedUserDocumentId;
      }

      await ProfessionalDetails.updateOne(
        { applicationId: applicationId },
        { $set: professionalUpdate },
        { upsert: true, session }
      );
    }

    if (effective.subscriptionDetails) {
      // Ensure dateJoined is set - use from effective or current date
      const subscriptionDetailsToSave = {
        ...effective.subscriptionDetails,
        dateJoined: effective.subscriptionDetails.dateJoined ?? new Date(),
      };

      const subscriptionUpdate = {
        subscriptionDetails: subscriptionDetailsToSave,
      };

      // Link portal userId if found
      if (linkedUserDocumentId) {
        subscriptionUpdate.userId = linkedUserDocumentId;
      }

      await SubscriptionDetails.findOneAndUpdate(
        { applicationId: applicationId },
        { $set: subscriptionUpdate },
        { upsert: true, new: true, runValidators: true, session }
      );
      // Do not update Profile.currentSubscriptionId or hasHistory here.
      // This will be handled via subscription-service RabbitMQ events.
    }

    // 3) Close overlay (decided)
    overlay.status = "decided";
    overlay.decision = "approved";
    overlay.decisionReason = undefined;
    overlay.overlayVersion += 1;
    await overlay.save({ session });

    // 4) Publish events using shared middleware
    // 4) Publish events using dedicated publisher
    const subscriptionAttributes = {
      payrollNo: effective.subscriptionDetails?.payrollNo ?? null,
      otherIrishTradeUnion:
        !!effective.subscriptionDetails?.otherIrishTradeUnion,
      otherIrishTradeUnionName:
        effective.subscriptionDetails?.otherIrishTradeUnionName ?? null,
      otherScheme: !!effective.subscriptionDetails?.otherScheme,
      recuritedBy: effective.subscriptionDetails?.recuritedBy ?? null,
      recuritedByMembershipNo:
        effective.subscriptionDetails?.recuritedByMembershipNo ?? null,
      confirmedRecruiterProfileId:
        effective.subscriptionDetails?.confirmedRecruiterProfileId ?? null,
      primarySection: effective.subscriptionDetails?.primarySection ?? null,
      otherPrimarySection:
        effective.subscriptionDetails?.otherPrimarySection ?? null,
      secondarySection: effective.subscriptionDetails?.secondarySection ?? null,
      otherSecondarySection:
        effective.subscriptionDetails?.otherSecondarySection ?? null,
      incomeProtectionScheme:
        !!effective.subscriptionDetails?.incomeProtectionScheme,
      inmoRewards: !!effective.subscriptionDetails?.inmoRewards,
      exclusiveDiscountsAndOffers:
        !!effective.subscriptionDetails?.exclusiveDiscountsAndOffers,
      valueAddedServices: !!effective.subscriptionDetails?.valueAddedServices,
      termsAndConditions:
        effective.subscriptionDetails?.termsAndConditions !== false,
      membershipCategory:
        effective.subscriptionDetails?.membershipCategory ?? null,
      membershipStatus: effective.subscriptionDetails?.membershipStatus ?? null,
      dateJoined: effective.subscriptionDetails?.dateJoined ?? null,
      submissionDate: effective.subscriptionDetails?.submissionDate ?? null,
      dateLeft: effective.subscriptionDetails?.dateLeft ?? null,
      reasonLeft: effective.subscriptionDetails?.reasonLeft ?? null,
    };

    const updatedProfile = await Profile.findById(profile._id).session(session);
    const memberId = updatedProfile?.membershipNumber || null;
    const sub = effective.subscriptionDetails || {};
    const dateJoined = sub.dateJoined ?? new Date();

    await session.commitTransaction();

    await publishPostApprovalEvents({
      applicationId,
      reviewerId,
      profileId: profile._id,
      tenantId,
      isExistingProfile: !!existingProfile,
      updatedProfile,
      linkedUserId: portalUserId,
      effective: {
        ...effective,
        subscriptionAttributes,
      },
      memberId,
      dateJoined,
    });

    return { applicationId, effectiveHash, status: "processed" };
  } catch (e) {
    await session.abortTransaction();
    throw e;
  } finally {
    session.endSession();
  }
}

async function rejectApplication({
  applicationId,
  reason,
  notes,
  reviewerId,
  tenantId,
}) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const overlay = await ReviewOverlay.findOne({
      applicationId,
      status: "open",
    }).session(session);
    if (!overlay) throw new Error("Open overlay not found");

    const personalForEvent = await PersonalDetails.findOne({
      applicationId: applicationId,
    })
      .select("userId contactInfo")
      .session(session)
      .lean();

    // Update PersonalDetails status and approvalDetails
    await PersonalDetails.updateOne(
      { applicationId: applicationId },
      {
        $set: {
          applicationStatus: APPLICATION_STATUS.REJECTED,
          "meta.isActive": false,
          approvalDetails: {
            approvedBy: getReviewerIdForDb(reviewerId),
            approvedAt: new Date(),
            rejectionReason: reason,
            comments: notes,
          },
        },
      }
    ).session(session);

    overlay.status = "decided";
    overlay.decision = "rejected";
    overlay.decisionReason = reason;
    overlay.overlayVersion += 1;
    await overlay.save({ session });

    try {
      const userEmail =
        personalForEvent?.contactInfo?.personalEmail ||
        personalForEvent?.contactInfo?.workEmail ||
        null;
      const notificationUserId = await resolvePortalUserServiceId({
        tenantId,
        profileUserId: personalForEvent?.userId,
        linkedUserId: personalForEvent?.userId,
        userEmail,
      });
      await ApplicationApprovalEventPublisher.publishApplicationRejected({
        applicationId,
        reviewerId,
        reason,
        notes,
        tenantId,
        userId: notificationUserId,
        correlationId: crypto.randomUUID(),
      });
    } catch (publishError) {
      console.error(
        "[approval.service rejectApplication] Failed to publish application rejected event:",
        publishError.message
      );
    }

    await session.commitTransaction();
    return { applicationId, status: "rejected" };
  } catch (e) {
    await session.abortTransaction();
    throw e;
  } finally {
    session.endSession();
  }
}

module.exports = { approveApplication, rejectApplication };

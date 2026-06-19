const crypto = require("crypto");
const mongoose = require("mongoose");
const jsonPatch = require("fast-json-patch");
const { applyPatch } = jsonPatch;
const { AppError } = require("../errors/AppError");

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
const {
  APPLICATION_STATUS,
} = require("../constants/enums.js");
const { loadSubmission } = require("../services/submission.service.js");
const {
  findOrCreateProfileByEmail,
  findPortalUserByTenantEmail,
  resolveLinkedPortalUserIdForProfile,
  pickPrimaryEmail,
  normalizeEmail,
} = require("../services/profileLookup.service.js");
const {
  ensureDuplicateReviewAllowsApproval,
} = require("../services/duplicate.review.service.js");
const {
  publishPostApprovalEvents,
} = require("../services/publishPostApprovalEvents.js");
const {
  applyNoFeeMembershipPaymentDefaults,
  resolveSubscriptionPaymentFallbacks,
  hasPaymentTypeValue,
  hasPaymentFrequencyValue,
} = require("../helpers/noFeeMembershipPayment.helper.js");
const {
  generateMembershipNumber,
} = require("../helpers/membership.number.generator.js");
const {
  publishProfileAfterUpdateOne,
} = require("../services/profile.audit.publisher.js");
const {
  fetchLatestApplicationPayment,
  capturePaymentIntent,
} = require("../services/account.service.client.js");
const {
  assertSalaryDeductionAllowedForWorkLocation,
} = require("../helpers/workLocationPayment.helper.js");

const {
  parseDateOnlyToUtcNoon,
} = require("../helpers/parseDateOnly.js");
const { flattenProfilePayload } = require("../helpers/profile.transform.js");

const clone = (o) => JSON.parse(JSON.stringify(o));

function resolvePaymentIntentId(subscriptionDetails) {
  return (
    subscriptionDetails?.paymentDetails?.paymentIntentId ||
    subscriptionDetails?.paymentIntentId ||
    null
  );
}

const subAttrs = (s = {}) => ({
  payrollNo: s?.payrollNo ?? null,
  otherIrishTradeUnion: !!s?.otherIrishTradeUnion,
  otherIrishTradeUnionName: s?.otherIrishTradeUnionName ?? null,
  otherScheme: !!s?.otherScheme,
  recuritedBy: s?.recuritedBy ?? null,
  recuritedByMembershipNo: s?.recuritedByMembershipNo ?? null,
  confirmedRecruiterProfileId: s?.confirmedRecruiterProfileId ?? null,
  primarySection: s?.primarySection ?? null,
  otherPrimarySection: s?.otherPrimarySection ?? null,
  secondarySection: s?.secondarySection ?? null,
  otherSecondarySection: s?.otherSecondarySection ?? null,
  incomeProtectionScheme: !!s?.incomeProtectionScheme,
  inmoRewards: !!s?.inmoRewards,
  valueAddedServices: !!s?.valueAddedServices,
  termsAndConditions: s?.termsAndConditions !== false,
  membershipCategory: s?.membershipCategory ?? null,
  membershipStatus: s?.membershipStatus ?? null,
  dateJoined: s?.dateJoined ?? null,
  submissionDate: s?.submissionDate ?? null,
  dateLeft: s?.dateLeft ?? null,
  reasonLeft: s?.reasonLeft ?? null,
});

const pickSubForContract = (s = {}) => {
  const fallbacks = resolveSubscriptionPaymentFallbacks(s?.membershipCategory);
  return {
    membershipCategory: s?.membershipCategory ?? null,
    membershipStatus: s?.membershipStatus ?? "ACTIVE",
    dateJoined: s?.dateJoined ?? new Date().toISOString().slice(0, 10),
    dateLeft: s?.dateLeft ?? null,
    reasonLeft: s?.reasonLeft ?? null,
    paymentType: hasPaymentTypeValue(s?.paymentType)
      ? s.paymentType
      : fallbacks.paymentType,
    paymentFrequency: hasPaymentFrequencyValue(s?.paymentFrequency)
      ? s.paymentFrequency
      : fallbacks.paymentFrequency,
  };
};

const normalizeSubscription = (subscriptionDetails = {}, professional = {}) => {
  const normalized = { ...subscriptionDetails };
  if (
    normalized.membershipCategory == null &&
    professional?.membershipCategory != null
  ) {
    normalized.membershipCategory = professional.membershipCategory;
  }
  // Ensure dateJoined is set - use current date if not provided
  if (!normalized.dateJoined) {
    normalized.dateJoined = parseDateOnlyToUtcNoon(null, true);
  } else {
    normalized.dateJoined = parseDateOnlyToUtcNoon(normalized.dateJoined, true);
  }
  if (normalized.submissionDate) {
    normalized.submissionDate = parseDateOnlyToUtcNoon(
      normalized.submissionDate,
      false
    );
  }
  return applyNoFeeMembershipPaymentDefaults(normalized);
};

/**
 * Approve a single application (extracted logic for reuse)
 * This follows the exact same workflow as single approval
 */
async function approveSingleApplication({
  applicationId,
  tenantId,
  reviewerId,
  req,
  session,
  bulkDateJoined = null, // Optional dateJoined from bulk approval request
}) {
  try {
    // First check if application exists in database
    const personalDetails = await PersonalDetails.findOne({
      applicationId: applicationId,
    }).session(session);

    if (!personalDetails) {
      return {
        applicationId,
        status: "failed",
        success: false,
        error: "Application not found in database",
      };
    }

    if (personalDetails.applicationStatus === APPLICATION_STATUS.PROCESSED) {
      return {
        applicationId,
        status: "failed",
        success: false,
        error: "Application has already been processed.",
      };
    }

    try {
      await ensureDuplicateReviewAllowsApproval(applicationId, tenantId);
    } catch (duplicateError) {
      return {
        applicationId,
        status: "failed",
        success: false,
        error: duplicateError.message,
        code: duplicateError.code || "DUPLICATE_REVIEW_REQUIRED",
      };
    }

    const { submission: serverSubmission } = await loadSubmission(
      applicationId
    );

    // Determine patch source - same logic as single approval
    // For bulk approval, we check for open overlay first, then use submission as-is
    let patchToApply = [];
    let overlay = null;

    // Check if there's an open overlay for this application
    overlay = await ReviewOverlay.findOne({
      applicationId,
      status: "open",
    }).session(session);

    if (overlay) {
      // Use overlay's proposed patch if it exists
      patchToApply = overlay.proposedPatch ?? [];
    }
    // If no overlay, patchToApply remains [] (approve with current submission as-is)

    // Apply patch to authoritative submission
    let effective;
    try {
      effective = applyPatch(
        clone(serverSubmission),
        patchToApply,
        true
      ).newDocument;
    } catch (error) {
      throw new Error(`Failed to apply patch: ${error.message}`);
    }

    const normalizedSubscriptionDetails = normalizeSubscription(
      effective.subscriptionDetails,
      effective.professionalDetails
    );

    // Log dateJoined for debugging (same as single approval)
    console.log(`[bulkApproval] dateJoined check for ${applicationId}:`, {
      beforeNormalize: effective.subscriptionDetails?.dateJoined,
      afterNormalize: normalizedSubscriptionDetails?.dateJoined,
      hasDateJoined: !!normalizedSubscriptionDetails?.dateJoined,
    });

    effective = {
      ...effective,
      subscriptionDetails: normalizedSubscriptionDetails,
    };

    await assertSalaryDeductionAllowedForWorkLocation(
      effective.subscriptionDetails,
      effective.professionalDetails,
      { req, tenantId },
    );

    const existingSubscriptionForPayment = await SubscriptionDetails.findOne({
      applicationId,
      tenantId: String(tenantId),
    })
      .select("paymentDetails")
      .lean();
    const latestPayment = await fetchLatestApplicationPayment(
      applicationId,
      tenantId,
      req,
    );
    const paymentIntentId =
      latestPayment?.paymentIntentId ||
      resolvePaymentIntentId(existingSubscriptionForPayment);
    let captureResult = null;
    if (paymentIntentId) {
      captureResult = await capturePaymentIntent(paymentIntentId, tenantId, req);
      if (captureResult.status !== "succeeded") {
        throw new Error(
          "Payment capture did not succeed. Application was not processed.",
        );
      }
    }

    // Flatten payload for profile storage
    const flattenedProfileFields = flattenProfilePayload(effective);

    // Find existing profile or create new one
    const email =
      effective.contactInfo?.personalEmail || effective.contactInfo?.workEmail;
    if (!email) throw new Error("No email found in effective data");

    const normalizedEmail = email.toLowerCase();
    let existingProfile = await Profile.findOne({
      tenantId,
      normalizedEmail,
    }).session(session);

    // Get userId and userType from effective
    const userId = effective?.userId || null;
    const userType = effective?.userType || null;

    const portalUser = await findPortalUserByTenantEmail(
      tenantId,
      normalizedEmail,
      session
    );
    const portalUserId = portalUser?.userId || null;
    const portalUserDocumentId = portalUser?._id || null;
    const linkedUserId = resolveLinkedPortalUserIdForProfile(
      userType,
      userId,
      portalUserId
    );
    const linkedUserDocumentId =
      portalUserDocumentId || toObjectIdOrNull(linkedUserId);

    let profile;
    if (existingProfile) {
      // Update existing profile - keep existing membership number
      const updateFields = { ...flattenedProfileFields };

      // Match findOrCreateProfileByEmail: keep Profile.normalizedEmail in sync with preferred primary email
      const existingContactInfo = existingProfile.contactInfo?.toObject
        ? existingProfile.contactInfo.toObject()
        : existingProfile.contactInfo || {};
      const updatedContactInfo = {
        ...existingContactInfo,
        ...(flattenedProfileFields.contactInfo || {}),
      };
      const primaryEmail = pickPrimaryEmail(updatedContactInfo);
      if (primaryEmail) {
        updateFields.normalizedEmail = normalizeEmail(primaryEmail);
      }

      if (!existingProfile.membershipNumber) {
        const membershipNumber = await generateMembershipNumber();
        updateFields.membershipNumber = membershipNumber;
        console.log(
          `✅ Generated membership number ${membershipNumber} for existing profile ${existingProfile._id}`
        );
      }

      if (
        linkedUserDocumentId &&
        String(existingProfile.userId || "") !== String(linkedUserDocumentId)
      ) {
        updateFields.userId = linkedUserDocumentId;
      }

      // Set crmUserId (the user who approved this profile)
      updateFields.crmUserId = getReviewerIdForDb(reviewerId);

      const beforeLean = existingProfile.toObject({ depopulate: true });
      await Profile.updateOne(
        { _id: existingProfile._id },
        {
          $set: updateFields,
        },
        { session }
      );
      await publishProfileAfterUpdateOne({
        tenantId,
        profileId: existingProfile._id,
        beforeLean,
        session,
        actorId: reviewerId,
        source: "bulkApproval",
      });
      profile = existingProfile;
    } else {
      // Create new profile - will get new membership number
      const { profile: createdProfile } = await findOrCreateProfileByEmail({
        tenantId,
        effective,
        reviewerId,
        session,
      });
      profile = createdProfile;

      // Update Profile with approved data
      const updateFields = { ...flattenedProfileFields };

      if (linkedUserDocumentId) {
        updateFields.userId = linkedUserDocumentId;
      }

      // Set crmUserId (the user who approved this profile)
      updateFields.crmUserId = getReviewerIdForDb(reviewerId);

      const beforeSecond = await Profile.findById(profile._id).session(session).lean();
      await Profile.updateOne(
        { _id: profile._id },
        {
          $set: updateFields,
        },
        { session }
      );
      await publishProfileAfterUpdateOne({
        tenantId,
        profileId: profile._id,
        beforeLean: beforeSecond,
        session,
        actorId: reviewerId,
        source: "bulkApproval",
      });
    }

    // Update main application models with approved data
    if (effective.personalInfo) {
      const personalSet = {
        personalInfo: effective.personalInfo,
        contactInfo: effective.contactInfo,
        applicationStatus: APPLICATION_STATUS.PROCESSED,
        profileId: profile._id,
        "meta.isActive": true,
        "approvalDetails.approvedBy": getReviewerIdForDb(reviewerId),
        "approvalDetails.approvedAt": new Date(),
      };
      if (linkedUserDocumentId) {
        personalSet.userId = linkedUserDocumentId;
      }
      await PersonalDetails.updateOne(
        { applicationId: applicationId },
        { $set: personalSet },
        { upsert: true, session }
      );
    }

    if (effective.professionalDetails) {
      const profSet = { professionalDetails: effective.professionalDetails };
      if (linkedUserDocumentId) {
        profSet.userId = linkedUserDocumentId;
      }
      await ProfessionalDetails.updateOne(
        { applicationId: applicationId },
        { $set: profSet },
        { upsert: true, session }
      );
    }

    if (effective.subscriptionDetails) {
      // Membership start stays the application's dateJoined; bulk processingDate is only for billing (passed separately).
      const resolvedDateJoined = parseDateOnlyToUtcNoon(
        effective.subscriptionDetails.dateJoined,
        true
      );
      const subscriptionDetailsToSave = {
        ...effective.subscriptionDetails,
        dateJoined: resolvedDateJoined,
      };

      const subSet = { subscriptionDetails: subscriptionDetailsToSave };
      if (captureResult) {
        subSet.paymentDetails = {
          ...(existingSubscriptionForPayment?.paymentDetails || {}),
          paymentIntentId,
          status: "Captured",
          attemptNumber: latestPayment?.attemptNumber,
          updatedAt: new Date(),
        };
      }
      if (linkedUserDocumentId) {
        subSet.userId = linkedUserDocumentId;
      }
      await SubscriptionDetails.findOneAndUpdate(
        { applicationId: applicationId },
        { $set: subSet },
        { upsert: true, new: true, runValidators: true, session }
      );

      effective = {
        ...effective,
        subscriptionDetails: subscriptionDetailsToSave,
      };
    }

    // Close overlay if used
    if (overlay && overlay.status === "open") {
      overlay.status = "decided";
      overlay.decision = "approved";
      overlay.overlayVersion += 1;
      await overlay.save({ session });
    }

    const updatedProfile = await Profile.findById(profile._id).session(session);
    const memberId = updatedProfile?.membershipNumber || null;
    const sub = effective.subscriptionDetails || {};
    const dateJoinedForSub = parseDateOnlyToUtcNoon(sub.dateJoined, true);
    const processingDateSerialized =
      bulkDateJoined != null
        ? bulkDateJoined instanceof Date
          ? bulkDateJoined.toISOString().split("T")[0]
          : String(bulkDateJoined).split("T")[0]
        : undefined;

    return {
      applicationId,
      profileId: String(profile._id),
      status: "processed",
      success: true,
      postApprovalPayload: {
        applicationId,
        reviewerId,
        profileId: profile._id,
        tenantId,
        isExistingProfile: !!existingProfile,
        updatedProfile,
        linkedUserId: linkedUserDocumentId,
        effective: {
          ...effective,
          subscriptionAttributes: subAttrs(effective.subscriptionDetails),
        },
        memberId,
        dateJoined: dateJoinedForSub,
        processingDate: processingDateSerialized,
      },
    };
  } catch (error) {
    return {
      applicationId,
      status: "failed",
      success: false,
      error: error.message,
    };
  }
}

async function bulkApproveApplications(req, res, next) {
  const { applicationIds, processingDate } = req.body;
  const tenantId = req.tenantId;
  // Get reviewerId from req.user.id or fallback to req.userId (set by auth middleware)
  const reviewerId = req.user?.id || req.userId;

  if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
    return next(AppError.badRequest("applicationIds must be a non-empty array"));
  }

  // Limit batch size
  if (applicationIds.length > 1000) {
    return next(AppError.badRequest("Maximum 1000 applications can be processed at once"));
  }

  // Parse processingDate if provided (convert string to Date if needed)
  const bulkDateJoined = processingDate
    ? processingDate instanceof Date
      ? processingDate
      : new Date(processingDate)
    : null;

  const results = [];

  try {
    // Process each application independently
    // Each application gets its own transaction to ensure one failure doesn't affect others
    for (const applicationId of applicationIds) {
      try {
        // Start a new session for each application to ensure isolation
        const appSession = await mongoose.startSession();
        appSession.startTransaction();

        try {
          const result = await approveSingleApplication({
            applicationId,
            tenantId,
            reviewerId,
            req,
            session: appSession,
            bulkDateJoined, // Pass bulkDateJoined to use for all subscriptions
          });

          await appSession.commitTransaction();
          if (result.postApprovalPayload) {
            await publishPostApprovalEvents(result.postApprovalPayload);
          }
          results.push({
            applicationId: result.applicationId,
            profileId: result.profileId,
            status: result.status,
            success: result.success,
          });
        } catch (error) {
          await appSession.abortTransaction();
          results.push({
            applicationId,
            status: "failed",
            success: false,
            error: error.message,
          });
        } finally {
          appSession.endSession();
        }
      } catch (error) {
        results.push({
          applicationId,
          status: "failed",
          success: false,
          error: error.message || "Unknown error",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    return res.status(200).json({
      message: "Bulk approval processed",
      total: applicationIds.length,
      successful: successCount,
      failed: failureCount,
      results: results,
    });
  } catch (error) {
    console.error("[bulkApproveApplications] Error:", {
      message: error.message,
      stack: error.stack,
      tenantId,
      reviewerId,
    });
    return next(error);
  }
}

module.exports = { bulkApproveApplications };

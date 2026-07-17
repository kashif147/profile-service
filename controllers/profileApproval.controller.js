const crypto = require("crypto");
const mongoose = require("mongoose");
const jsonPatch = require("fast-json-patch");
const { applyPatch } = jsonPatch;
const { AppError } = require("../errors/AppError");

const ReviewOverlay = require("../models/reviewOverlay.model.js");
const PersonalDetails = require("../models/personal.details.model.js");
const ProfessionalDetails = require("../models/professional.details.model.js");
const SubscriptionDetails = require("../models/subscription.model.js");
const Profile = require("../models/profile.model.js");
const {
  APPLICATION_STATUS,
} = require("../constants/enums.js");
const { loadSubmission } = require("../services/submission.service.js");
const ApplicationApprovalEventPublisher = require("../rabbitMQ/publishers/application.approval.publisher.js");
const {
  ensureDuplicateReviewAllowsApproval,
  resolveProfileForApproval,
} = require("../services/duplicate.review.service.js");
const {
  publishPostApprovalEvents,
} = require("../services/publishPostApprovalEvents.js");
const {
  resolvePortalUserServiceId,
} = require("../helpers/portalUserIdentity.js");
const {
  applyNoFeeMembershipPaymentDefaults,
  resolveSubscriptionPaymentFallbacks,
  hasPaymentTypeValue,
  hasPaymentFrequencyValue,
} = require("../helpers/noFeeMembershipPayment.helper.js");
const { flattenProfilePayload } = require("../helpers/profile.transform.js");
const {
  parseDateOnlyToUtcNoon,
} = require("../helpers/parseDateOnly.js");
const {
  getReviewerIdForDb,
  toObjectIdOrNull,
} = require("../helpers/reviewerIdForDb.js");
const {
  fetchLatestApplicationPayment,
  capturePaymentIntent,
  cancelPaymentIntent,
  normalizePaymentStatus,
} = require("../services/account.service.client.js");
const {
  assertSalaryDeductionAllowedForWorkLocation,
} = require("../helpers/workLocationPayment.helper.js");
const {
  fetchCurrentSubscriptionByProfileId,
} = require("../services/subscription.service.client.js");
const {
  resolveGapLetterEligibility,
} = require("../helpers/gapLetterEligibility.helper.js");

const clone = (o) => JSON.parse(JSON.stringify(o));
const APPROVAL_TRANSACTION_MAX_ATTEMPTS = 3;

function isTransientTransactionError(error) {
  if (!error) return false;
  if (typeof error.hasErrorLabel === "function") {
    return error.hasErrorLabel("TransientTransactionError");
  }
  if (Array.isArray(error.errorLabels)) {
    return error.errorLabels.includes("TransientTransactionError");
  }
  return (
    error.code === 112 ||
    /write conflict/i.test(error.message || "")
  );
}

function transactionRetryDelay(attempt) {
  return new Promise((resolve) => setTimeout(resolve, 75 * attempt));
}

function resolvePaymentIntentId(subscriptionDetails) {
  return (
    subscriptionDetails?.paymentDetails?.paymentIntentId ||
    subscriptionDetails?.paymentIntentId ||
    null
  );
}

async function resolveLatestPaymentIntentId({
  applicationId,
  tenantId,
  req,
  fallbackSubscription,
}) {
  const latestPayment = await fetchLatestApplicationPayment(
    applicationId,
    tenantId,
    req,
  );
  return {
    paymentIntentId:
      latestPayment?.paymentIntentId || resolvePaymentIntentId(fallbackSubscription),
    latestPayment,
  };
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

async function resolveGapLetterForApproval({
  approvalEffective,
  profile,
  tenantId,
  req,
}) {
  const previousSubscription = profile?._id
    ? await fetchCurrentSubscriptionByProfileId(
        String(profile._id),
        tenantId,
        req,
        profile.currentSubscriptionId || null,
      )
    : null;

  return resolveGapLetterEligibility({
    requestedSendGapLetter:
      approvalEffective?.subscriptionDetails?.sendGapLetter,
    membershipCategory:
      approvalEffective?.subscriptionDetails?.membershipCategory ??
      approvalEffective?.professionalDetails?.membershipCategory ??
      null,
    previousSubscription,
  });
}

// Optional path whitelist, shared with overlay controller
const ALLOWED_PREFIXES = [
  "/personalInfo",
  "/contactInfo",
  "/professionalDetails",
  "/subscriptionDetails",
];
function validatePatchPaths(patch) {
  const bad = patch?.find(
    (op) =>
      !ALLOWED_PREFIXES.some(
        (p) => op.path === p || op.path.startsWith(p + "/")
      )
  );
  if (bad) {
    throw AppError.badRequest(`Patch path not allowed: ${bad.path}`);
  }
  const blocked = patch?.find((op) =>
    op.path.startsWith("/professionalDetails/membershipCategory")
  );
  if (blocked) {
    throw AppError.badRequest(
      "membershipCategory must be modified under subscriptionDetails",
    );
  }
}

async function approveApplication(req, res, next) {
  const { applicationId } = req.params;
  const { overlayId, overlayVersion, submission, proposedPatch } = req.body;
  const tenantId = req.tenantId;
  
  // reviewerId = ID of the user who is approving this application (the CRM user making the request)
  // This comes from the authenticated user's ID in the request (set by auth middleware)
  const reviewerId = req.user?.id || req.userId;
  
  // Log reviewerId for debugging
  if (!reviewerId) {
    console.warn("[approveApplication] WARNING: reviewerId (approver user ID) is missing. req.user:", req.user, "req.userId:", req.userId);
  } else {
    console.log("[approveApplication] reviewerId (approver user ID):", reviewerId, "userType:", req.user?.userType);
  }

  let captureResult = null;
  let capturedPaymentIntentId = null;
  let capturedLatestPayment = null;

  for (let attempt = 1; attempt <= APPROVAL_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
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
      throw AppError.conflict("Application has already been processed.");
    }

    const { submission: serverSubmission } = await loadSubmission(
      applicationId
    );

    // Determine patch source
    let patchToApply = [];
    let overlay = null;

    if (overlayId) {
      overlay = await ReviewOverlay.findOne({
        overlayId,
        applicationId,
        status: "open",
      }).session(session);
      if (!overlay) {
        throw AppError.notFound("Overlay not found");
      }
      if (overlay.overlayVersion !== overlayVersion) {
        throw AppError.conflict("Overlay version conflict");
      }
      patchToApply = overlay.proposedPatch ?? [];
    } else if (submission) {
      // submission provided - proposedPatch is optional (empty array if not provided)
      if (proposedPatch) {
        validatePatchPaths(proposedPatch);
        patchToApply = proposedPatch;
      }
      // else patchToApply remains [] (no changes)
    }

    // Apply patch to authoritative submission
    let effective;
    try {
      effective = applyPatch(
        clone(serverSubmission),
        patchToApply,
        true
      ).newDocument;
    } catch {
      throw AppError.conflict("Submission changed; refresh and reapply changes.");
    }

    const normalizedSubscriptionDetails = normalizeSubscription(
      effective.subscriptionDetails,
      effective.professionalDetails
    );

    // Log dateJoined for debugging
    console.log("[approveApplication] dateJoined check:", {
      beforeNormalize: effective.subscriptionDetails?.dateJoined,
      afterNormalize: normalizedSubscriptionDetails?.dateJoined,
      hasDateJoined: !!normalizedSubscriptionDetails?.dateJoined,
    });

    effective = {
      ...effective,
      subscriptionDetails: normalizedSubscriptionDetails,
    };

    const personalForReview = await ensureDuplicateReviewAllowsApproval(
      applicationId,
      tenantId,
    );

    await assertSalaryDeductionAllowedForWorkLocation(
      effective.subscriptionDetails,
      effective.professionalDetails,
      { req, tenantId },
    );

    const existingSubscription = await SubscriptionDetails.findOne({
      applicationId,
      tenantId: String(tenantId),
    })
      .select("paymentDetails")
      .session(session)
      .lean();
    const { paymentIntentId, latestPayment } = await resolveLatestPaymentIntentId({
      applicationId,
      tenantId,
      req,
      fallbackSubscription: existingSubscription,
    });

    if (paymentIntentId) {
      if (!captureResult || capturedPaymentIntentId !== paymentIntentId) {
        try {
          captureResult = await capturePaymentIntent(
            paymentIntentId,
            tenantId,
            req,
          );
          capturedPaymentIntentId = paymentIntentId;
          capturedLatestPayment = latestPayment;
        } catch (captureError) {
          throw AppError.conflict(
            captureError.message ||
              "Payment capture failed. Application was not approved.",
          );
        }
      }

      if (captureResult.status !== "succeeded") {
        throw AppError.conflict(
          "Payment capture did not succeed. Application was not approved.",
        );
      }
    }

    const {
      profile,
      linkedUserId,
      isExistingProfile,
      approvalEffective: resolvedApprovalEffective,
    } = await resolveProfileForApproval({
      applicationId,
      tenantId,
      effective,
      reviewerId,
      duplicateReview: personalForReview.duplicateReview,
      session,
    });

    let approvalEffective = resolvedApprovalEffective;
    const approvalSubscriptionDetails = normalizeSubscription(
      approvalEffective.subscriptionDetails,
      approvalEffective.professionalDetails,
    );
    approvalEffective = {
      ...approvalEffective,
      subscriptionDetails: approvalSubscriptionDetails,
    };
    await assertSalaryDeductionAllowedForWorkLocation(
      approvalEffective.subscriptionDetails,
      approvalEffective.professionalDetails,
      { req, tenantId },
    );

    const gapLetter = await resolveGapLetterForApproval({
      approvalEffective,
      profile,
      tenantId,
      req,
    });
    approvalEffective = {
      ...approvalEffective,
      subscriptionDetails: {
        ...approvalEffective.subscriptionDetails,
        sendGapLetter: gapLetter.sendGapLetter,
      },
    };

    // Update main application models with approved data
    if (approvalEffective.personalInfo) {
      const personalSet = {
        personalInfo: approvalEffective.personalInfo,
        contactInfo: approvalEffective.contactInfo,
        applicationStatus: APPLICATION_STATUS.PROCESSED,
        profileId: profile._id,
        "meta.isActive": true,
        "approvalDetails.approvedBy": getReviewerIdForDb(reviewerId),
        "approvalDetails.approvedAt": new Date(),
      };
      if (linkedUserId) {
        const linkedUserObjectId = toObjectIdOrNull(linkedUserId);
        if (linkedUserObjectId) {
          personalSet.userId = linkedUserObjectId;
        }
      }
      await PersonalDetails.updateOne(
        { applicationId: applicationId },
        { $set: personalSet },
        { upsert: true, session }
      );
    }

    if (approvalEffective.professionalDetails) {
      const profSet = { professionalDetails: approvalEffective.professionalDetails };
      if (linkedUserId) {
        const linkedUserObjectId = toObjectIdOrNull(linkedUserId);
        if (linkedUserObjectId) {
          profSet.userId = linkedUserObjectId;
        }
      }
      await ProfessionalDetails.updateOne(
        { applicationId: applicationId },
        { $set: profSet },
        { upsert: true, session }
      );
    }

    if (approvalEffective.subscriptionDetails) {
      // Ensure dateJoined is set - use from approval effective or current date
      const subscriptionDetailsToSave = {
        ...approvalEffective.subscriptionDetails,
        dateJoined: approvalEffective.subscriptionDetails.dateJoined ?? new Date(),
      };

      const subSet = { subscriptionDetails: subscriptionDetailsToSave };
      if (captureResult) {
        subSet.paymentDetails = {
          ...(existingSubscription?.paymentDetails || {}),
          paymentIntentId,
          status: "Captured",
          attemptNumber:
            (capturedPaymentIntentId === paymentIntentId
              ? capturedLatestPayment?.attemptNumber
              : latestPayment?.attemptNumber),
          updatedAt: new Date(),
        };
      }
      if (linkedUserId) {
        const linkedUserObjectId = toObjectIdOrNull(linkedUserId);
        if (linkedUserObjectId) {
          subSet.userId = linkedUserObjectId;
        }
      }
      await SubscriptionDetails.findOneAndUpdate(
        { applicationId: applicationId },
        { $set: subSet },
        { upsert: true, new: true, runValidators: true, session }
      );
      // Do not update Profile.currentSubscriptionId or hasHistory here.
      // This will be handled via subscription-service RabbitMQ events.
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
    const sub = approvalEffective.subscriptionDetails || {};
    const dateJoined = parseDateOnlyToUtcNoon(sub.dateJoined, true);
    const postApprovalPayload = {
      applicationId,
      reviewerId,
      profileId: profile._id,
      tenantId,
      isExistingProfile: !!isExistingProfile,
      updatedProfile,
      linkedUserId,
      effective: {
        ...approvalEffective,
        subscriptionAttributes: subAttrs(approvalEffective.subscriptionDetails),
      },
      memberId,
      dateJoined,
      gapLetter,
    };

    await session.commitTransaction();

    await publishPostApprovalEvents(postApprovalPayload);
    return res.status(200).json({
      applicationId,
      profileId: String(profile._id),
      status: "processed",
      paymentStatus: captureResult ? "Captured" : undefined,
      proposedPatch: patchToApply,
    });
    } catch (e) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      if (
        isTransientTransactionError(e) &&
        attempt < APPROVAL_TRANSACTION_MAX_ATTEMPTS
      ) {
        console.warn("[approveApplication] Retrying transient transaction error:", {
          message: e.message,
          applicationId,
          tenantId,
          attempt,
          nextAttempt: attempt + 1,
        });
        await transactionRetryDelay(attempt);
        continue;
      }

      console.error("[approveApplication] Error details:", {
        message: e.message,
        stack: e.stack,
        name: e.name,
        applicationId,
        reviewerId,
        tenantId,
        attempt,
      });
      return next(e);
    } finally {
      session.endSession();
    }
  }
}

async function rejectApplication(req, res, next) {
  const { applicationId } = req.params;
  const {
    reason,
    notes,
    overlayId,
    overlayVersion /* submission, proposedPatch optional for audit */,
  } = req.body;
  const tenantId = req.tenantId;
  
  // reviewerId = ID of the user who is rejecting this application (the CRM user making the request)
  // This comes from the authenticated user's ID in the request (set by auth middleware)
  const reviewerId = req.user?.id || req.userId;

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const existingSubscription = await SubscriptionDetails.findOne({
      applicationId,
      tenantId: String(tenantId),
    })
      .select("paymentDetails")
      .lean();
    const { paymentIntentId, latestPayment } = await resolveLatestPaymentIntentId({
      applicationId,
      tenantId,
      req,
      fallbackSubscription: existingSubscription,
    });
    let cancelResult = null;

    if (paymentIntentId) {
      try {
        cancelResult = await cancelPaymentIntent(paymentIntentId, tenantId, req);
      } catch (cancelError) {
        await session.abortTransaction();
        return next(
          AppError.conflict(
            cancelError.message ||
              "Payment cancellation failed. Application was not rejected.",
          ),
        );
      }
    }

    if (overlayId) {
      const overlay = await ReviewOverlay.findOne({
        overlayId,
        applicationId,
        status: "open",
      }).session(session);
      if (!overlay) {
        await session.abortTransaction();
        return next(AppError.notFound("Overlay not found"));
      }
      if (overlay.overlayVersion !== overlayVersion) {
        await session.abortTransaction();
        return next(AppError.conflict("Overlay version conflict"));
      }
      overlay.status = "decided";
      overlay.decision = "rejected";
      overlay.decisionReason = reason;
      overlay.notes = notes ?? overlay.notes;
      overlay.overlayVersion += 1;
      await overlay.save({ session });
    } else {
      const openOverlay = await ReviewOverlay.findOne({
        applicationId,
        status: "open",
      }).session(session);
      if (openOverlay) {
        openOverlay.status = "decided";
        openOverlay.decision = "rejected";
        openOverlay.decisionReason = reason;
        openOverlay.overlayVersion += 1;
        await openOverlay.save({ session });
      }
    }

    const personalForEvent = await PersonalDetails.findOne({
      applicationId: applicationId,
    })
      .select("userId contactInfo")
      .session(session)
      .lean();

    // Update PersonalDetails with rejection status and details
    await PersonalDetails.updateOne(
      { applicationId: applicationId },
      {
        $set: {
          applicationStatus: APPLICATION_STATUS.REJECTED,
          "meta.isActive": false,
          "approvalDetails.approvedBy": getReviewerIdForDb(reviewerId),
          "approvalDetails.approvedAt": new Date(),
          "approvalDetails.rejectionReason": reason,
          "approvalDetails.comments": notes ?? null,
        },
      },
      { session }
    );

    // Note: ProfessionalDetails and SubscriptionDetails are kept as-is (not deleted)
    // No Profile is created for rejected applications
    if (paymentIntentId && cancelResult?.status) {
      await SubscriptionDetails.updateOne(
        { applicationId },
        {
          $set: {
            paymentDetails: {
              ...(existingSubscription?.paymentDetails || {}),
              paymentIntentId,
              status: normalizePaymentStatus(cancelResult.status),
              attemptNumber: latestPayment?.attemptNumber,
              updatedAt: new Date(),
            },
          },
        },
        { session },
      );
    }

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
        "[rejectApplication] Failed to publish application rejected event:",
        publishError.message
      );
    }

    await session.commitTransaction();
    return res.status(200).json({
      applicationId,
      status: "rejected",
      paymentStatus: cancelResult?.displayStatus,
    });
  } catch (e) {
    await session.abortTransaction();
    next(e);
  } finally {
    session.endSession();
  }
}

module.exports = { approveApplication, rejectApplication };

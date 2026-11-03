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
  claimPaymentDecision,
  releasePaymentDecision,
  endPaymentDecisionLease,
} = require("../services/applicationPaymentDecision.service.js");
const {
  currentReviewVersion,
  reviewVersionFilter,
} = require("../services/duplicate.review.version.js");

// P5: the duplicate review changed between the reviewer's decision and this approval. Before any
// capture nothing moved; after a capture the claim is kept and re-reviewing then approving again
// completes the approval with the same (already captured) payment.
function reviewChangedError(captured) {
  return AppError.conflict(
    captured
      ? "The duplicate review changed after the payment was captured. Review duplicates again, then approve again to complete this application (the payment will not be taken twice)."
      : "The duplicate review changed during approval. Review duplicates again, then approve.",
    { code: captured ? "REVIEW_CHANGED_AFTER_CAPTURE" : "REVIEW_CHANGED", paymentCaptured: !!captured },
  );
}

// Account Payment document id from the latest-payment lookup (shape differs by account version).
function paymentIdOf(latestPayment) {
  const id = latestPayment?.paymentId || latestPayment?.id || latestPayment?._id || null;
  return id ? String(id) : null;
}
const {
  assertSalaryDeductionAllowedForWorkLocation,
} = require("../helpers/workLocationPayment.helper.js");
const {
  fetchCurrentSubscriptionByProfileId,
} = require("../services/subscription.service.client.js");
const {
  resolveGapLetterEligibility,
} = require("../helpers/gapLetterEligibility.helper.js");
const {
  resolveApprovalPaymentIntent,
} = require("../services/applicationPaymentLink.service.js");

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
  const tenantId = req.tenantId ? String(req.tenantId) : null;
  if (!tenantId) {
    return next(AppError.forbidden("Tenant context is required"));
  }
  
  // reviewerId = ID of the user who is approving this application (the CRM user making the request)
  // This comes from the authenticated user's ID in the request (set by auth middleware)
  const reviewerId = req.user?.id || req.userId;
  
  // Log reviewerId for debugging
  if (!reviewerId) {
    console.warn("[approveApplication] WARNING: reviewerId (approver user ID) is missing. req.user:", req.user, "req.userId:", req.userId);
  } else {
    console.log("[approveApplication] reviewerId (approver user ID):", reviewerId, "userType:", req.user?.userType);
  }

  // P5: the duplicate-review gate runs BEFORE the claim and any capture, and the approval is bound
  // to the review version it passed: a failed gate takes no claim and makes no payment call.
  let gatedVersion;
  try {
    const gatedReview = await ensureDuplicateReviewAllowsApproval(applicationId, tenantId);
    gatedVersion = currentReviewVersion(gatedReview);
  } catch (gateError) {
    return next(gateError);
  }

  // Committed approve decision BEFORE any capture (P5 bound payment commands): a concurrent reject
  // gets 409 and can never release the hold this approval is capturing.
  let decisionClaim;
  try {
    decisionClaim = await claimPaymentDecision({
      applicationId,
      tenantId,
      action: "approve",
      actorUserId: reviewerId,
      reviewVersion: gatedVersion,
    });
  } catch (claimError) {
    return next(claimError);
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
      tenantId,
    })
      .select("applicationStatus")
      .session(session);

    // No "null passes": an application not found in the trusted tenant (missing,
    // or owned by another tenant) is a 404 before any payment/profile side effect.
    if (!personalForStatus) {
      throw AppError.notFound("Application not found");
    }

    if (personalForStatus.applicationStatus === APPLICATION_STATUS.PROCESSED) {
      throw AppError.conflict("Application has already been processed.");
    }

    const { submission: serverSubmission } = await loadSubmission(
      applicationId,
      tenantId,
    );

    // Determine patch source
    let patchToApply = [];
    let overlay = null;

    if (overlayId) {
      overlay = await ReviewOverlay.findOne({
        overlayId,
        applicationId,
        tenantId,
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

    let personalForReview;
    try {
      personalForReview = await ensureDuplicateReviewAllowsApproval(applicationId, tenantId);
    } catch (gateError) {
      if (gateError?.code === "DUPLICATE_REVIEW_REQUIRED") throw reviewChangedError(!!captureResult);
      throw gateError;
    }
    if (currentReviewVersion(personalForReview) !== gatedVersion) {
      throw reviewChangedError(!!captureResult);
    }
    // P5: lock the reviewed state inside this transaction BEFORE any capture. This write makes any
    // concurrent review/detection write wait for (or conflict with) this transaction, and it only
    // matches while the review is still at the version this approval passed and the claim is ours.
    const reviewLock = await PersonalDetails.updateOne(
      {
        applicationId,
        tenantId,
        applicationStatus: { $nin: [APPLICATION_STATUS.PROCESSED, APPLICATION_STATUS.REJECTED] },
        "paymentDecision.claimId": decisionClaim.claimId,
        "paymentDecision.leaseId": decisionClaim.leaseId,
        ...reviewVersionFilter(gatedVersion),
      },
      { $set: { "paymentDecision.reviewVersion": gatedVersion } },
      { session },
    );
    if (!reviewLock.matchedCount) {
      throw reviewChangedError(!!captureResult);
    }

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
    // LINK mode: the link's own authorised PaymentIntent; INLINE: unchanged resolution.
    // Kept in sync with bulkApproval.controller.js.
    const { paymentIntentId, latestPayment } = await resolveApprovalPaymentIntent({
      personal: personalForReview,
      applicationId,
      tenantId,
      req,
      inlineResolver: () =>
        resolveLatestPaymentIntentId({
          applicationId,
          tenantId,
          req,
          fallbackSubscription: existingSubscription,
        }),
    });

    if (paymentIntentId) {
      if (!captureResult || capturedPaymentIntentId !== paymentIntentId) {
        try {
          captureResult = await capturePaymentIntent(
            paymentIntentId,
            tenantId,
            req,
            { applicationId, actorUserId: reviewerId, paymentId: paymentIdOf(latestPayment) },
          );
          capturedPaymentIntentId = paymentIntentId;
          capturedLatestPayment = latestPayment;
        } catch (captureError) {
          // Bound-command errors already carry the right status (400/404/409/503).
          if (captureError instanceof AppError) throw captureError;
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
        "paymentDecision.completedAt": new Date(),
      };
      if (linkedUserId) {
        const linkedUserObjectId = toObjectIdOrNull(linkedUserId);
        if (linkedUserObjectId) {
          personalSet.userId = linkedUserObjectId;
        }
      }
      await PersonalDetails.updateOne(
        { applicationId: applicationId, tenantId },
        { $set: personalSet },
        { session }
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
        { applicationId: applicationId, tenantId },
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
        { applicationId: applicationId, tenantId },
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

    const updatedProfile = await Profile.findOne({
      _id: profile._id,
      tenantId,
    }).session(session);
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
      // Nothing was captured: drop the claim so the application can be decided again. Once a
      // capture succeeded the claim stays (re-running approve is the recovery; reject stays blocked)
      // and only this run's lease ends, so that re-run can start at once.
      if (!captureResult) {
        await releasePaymentDecision({
          applicationId,
          tenantId,
          claimId: decisionClaim?.claimId,
          leaseId: decisionClaim?.leaseId,
        });
      } else {
        await endPaymentDecisionLease({
          applicationId,
          tenantId,
          claimId: decisionClaim?.claimId,
          leaseId: decisionClaim?.leaseId,
        });
      }
      return next(e);
    } finally {
      session.endSession();
    }
  }
}

// Reject failed after its claim: release it if no hold was released, otherwise keep it (money moved)
// and end only this run's lease so re-running reject can complete at once.
async function settleRejectClaim({ applicationId, tenantId, decisionClaim, cancelResult }) {
  const ids = { applicationId, tenantId, claimId: decisionClaim?.claimId, leaseId: decisionClaim?.leaseId };
  if (!cancelResult) await releasePaymentDecision(ids);
  else await endPaymentDecisionLease(ids);
}

async function rejectApplication(req, res, next) {
  const { applicationId } = req.params;
  const {
    reason,
    notes,
    overlayId,
    overlayVersion /* submission, proposedPatch optional for audit */,
  } = req.body;
  const tenantId = req.tenantId ? String(req.tenantId) : null;
  if (!tenantId) {
    return next(AppError.forbidden("Tenant context is required"));
  }

  // reviewerId = ID of the user who is rejecting this application (the CRM user making the request)
  // This comes from the authenticated user's ID in the request (set by auth middleware)
  const reviewerId = req.user?.id || req.userId;

  // Tenant-scoped existence check BEFORE cancelling any payment intent.
  const scopedApplication = await PersonalDetails.findOne({
    applicationId,
    tenantId,
  })
    .select("_id")
    .lean();
  if (!scopedApplication) {
    return next(AppError.notFound("Application not found"));
  }

  // Committed reject decision BEFORE any cancel (P5 bound payment commands).
  let decisionClaim;
  try {
    decisionClaim = await claimPaymentDecision({
      applicationId,
      tenantId,
      action: "reject",
      actorUserId: reviewerId,
    });
  } catch (claimError) {
    return next(claimError);
  }

  let cancelResult = null;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const existingSubscription = await SubscriptionDetails.findOne({
      applicationId,
      tenantId,
    })
      .select("paymentDetails")
      .lean();
    const { paymentIntentId, latestPayment } = await resolveLatestPaymentIntentId({
      applicationId,
      tenantId,
      req,
      fallbackSubscription: existingSubscription,
    });
    if (paymentIntentId) {
      try {
        cancelResult = await cancelPaymentIntent(paymentIntentId, tenantId, req, {
          applicationId,
          actorUserId: reviewerId,
          paymentId: paymentIdOf(latestPayment),
        });
      } catch (cancelError) {
        await session.abortTransaction();
        await releasePaymentDecision({ applicationId, tenantId, claimId: decisionClaim?.claimId, leaseId: decisionClaim?.leaseId });
        if (cancelError instanceof AppError) return next(cancelError);
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
        tenantId,
        status: "open",
      }).session(session);
      if (!overlay) {
        await session.abortTransaction();
        await settleRejectClaim({ applicationId, tenantId, decisionClaim, cancelResult });
        return next(AppError.notFound("Overlay not found"));
      }
      if (overlay.overlayVersion !== overlayVersion) {
        await session.abortTransaction();
        await settleRejectClaim({ applicationId, tenantId, decisionClaim, cancelResult });
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
        tenantId,
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
      tenantId,
    })
      .select("userId contactInfo")
      .session(session)
      .lean();

    // Update PersonalDetails with rejection status and details
    await PersonalDetails.updateOne(
      { applicationId: applicationId, tenantId },
      {
        $set: {
          applicationStatus: APPLICATION_STATUS.REJECTED,
          "meta.isActive": false,
          "approvalDetails.approvedBy": getReviewerIdForDb(reviewerId),
          "approvalDetails.approvedAt": new Date(),
          "approvalDetails.rejectionReason": reason,
          "approvalDetails.comments": notes ?? null,
          "paymentDecision.completedAt": new Date(),
        },
      },
      { session }
    );

    // Note: ProfessionalDetails and SubscriptionDetails are kept as-is (not deleted)
    // No Profile is created for rejected applications
    if (paymentIntentId && cancelResult?.status) {
      await SubscriptionDetails.updateOne(
        { applicationId, tenantId },
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
    // A released hold keeps the claim (approve must stay blocked); otherwise free it.
    await settleRejectClaim({ applicationId, tenantId, decisionClaim, cancelResult });
    next(e);
  } finally {
    session.endSession();
  }
}

module.exports = { approveApplication, rejectApplication };

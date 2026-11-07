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
  resolveApplicantPortalIdentity,
  pickPrimaryEmail,
  normalizeEmail,
} = require("../services/profileLookup.service.js");
const {
  ensureDuplicateReviewAllowsApproval,
  resolveProfileForApproval,
  assertNoProfileHoldsApplicantEmail,
  assertReviewedProfileTarget,
} = require("../services/duplicate.review.service.js");
const {
  currentReviewVersion,
  reviewVersionFilter,
} = require("../services/duplicate.review.version.js");
const {
  readIdempotencyKey,
  readExpectedReviewVersion,
  assertExpectedReviewVersion,
  observeDecision,
  operationHash,
} = require("../services/decisionPreconditions.js");
const { assertApprovalPaymentBinding } = require("../services/approvalPaymentBinding.js");
const {
  pendingIdentityLink,
  preserveIdentityContact,
  recordPendingIdentityLink,
} = require("../services/approvalIdentityLink.js");
const { DUPLICATE_REVIEW_STATUS } = require("../constants/enums.js");
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
  resolveApprovalPaymentIntent,
} = require("../services/applicationPaymentLink.service.js");
const {
  fetchLatestApplicationPayment,
  capturePaymentIntent,
} = require("../services/account.service.client.js");
const {
  claimPaymentDecision,
  releasePaymentDecision,
  endPaymentDecisionLease,
  findDecisionReplay,
  lockReviewForDecision,
  fencedDecisionUpdate,
} = require("../services/applicationPaymentDecision.service.js");
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

async function resolveGapLetterForApproval({
  effective,
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
    requestedSendGapLetter: effective?.subscriptionDetails?.sendGapLetter,
    membershipCategory:
      effective?.subscriptionDetails?.membershipCategory ??
      effective?.professionalDetails?.membershipCategory ??
      null,
    previousSubscription,
  });
}

// P5: same codes as single approval (profileApproval.controller.js reviewChangedError). Bulk makes
// one capture attempt per application, after the review lock, so a change is always pre-capture.
function reviewChangedError() {
  return AppError.conflict("The duplicate review changed during approval. Review duplicates again, then approve.", {
    code: "REVIEW_CHANGED",
    paymentCaptured: false,
  });
}

/**
 * Approve one application inside `session` (one transaction per application). Kept in step with
 * profileApproval.controller.js approveApplication: the caller already passed the duplicate gate
 * at `gatedVersion` and holds `decisionClaim`; here the review is re-checked and locked at that
 * version in the transaction BEFORE any capture, the payment must be bound to this application,
 * and LINKED/MERGED reviews resolve their profile exactly as single approval does.
 * Throws on any failure (the caller aborts the transaction and settles the claim).
 */
async function approveSingleApplication({
  applicationId,
  tenantId,
  reviewerId,
  req,
  session,
  bulkDateJoined = null, // Optional dateJoined from bulk approval request
  paymentState = {}, // set .captured once account-service captured this application's payment
  gatedVersion,
  decisionClaim,
}) {
    // Tenant-scoped: an application from another tenant reads as not found.
    const personalDetails = await PersonalDetails.findOne({
      applicationId: applicationId,
      tenantId,
    }).session(session);

    if (!personalDetails) {
      throw AppError.notFound("Application not found", { code: "APPLICATION_NOT_FOUND" });
    }

    if (personalDetails.applicationStatus === APPLICATION_STATUS.PROCESSED) {
      throw AppError.conflict("Application has already been processed.", { code: "APPLICATION_ALREADY_DECIDED" });
    }

    let personalForReview;
    try {
      personalForReview = await ensureDuplicateReviewAllowsApproval(applicationId, tenantId);
    } catch (gateError) {
      if (gateError?.code === "DUPLICATE_REVIEW_REQUIRED") throw reviewChangedError();
      throw gateError;
    }
    if (currentReviewVersion(personalForReview) !== gatedVersion) {
      throw reviewChangedError();
    }
    // P5: lock the reviewed state in this transaction BEFORE any capture (same as single approval):
    // matches only while the review is at the gated version and the claim AND lease are ours.
    await lockReviewForDecision({
      applicationId,
      tenantId,
      decisionClaim,
      reviewVersion: gatedVersion,
      session,
      reviewChanged: reviewChangedError,
    });
    const reviewStatus = personalForReview.duplicateReview?.status;

    const { submission: serverSubmission } = await loadSubmission(
      applicationId,
      tenantId,
    );

    // Determine patch source - same logic as single approval
    // For bulk approval, we check for open overlay first, then use submission as-is
    let patchToApply = [];
    let overlay = null;

    // Check if there's an open overlay for this application
    overlay = await ReviewOverlay.findOne({
      applicationId,
      tenantId,
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
    // P5 ownership, before any capture: the reviewed profile target is valid in this tenant.
    await assertReviewedProfileTarget({
      duplicateReview: personalForReview.duplicateReview,
      effective,
      tenantId,
      session,
    });

    const existingSubscriptionForPayment = await SubscriptionDetails.findOne({
      applicationId,
      tenantId: String(tenantId),
    })
      .select("paymentDetails")
      .lean();
    // LINK mode: the link's own authorised PaymentIntent; INLINE: unchanged resolution.
    // Kept in sync with profileApproval.controller.js.
    const { paymentIntentId, latestPayment, mode: paymentMode } = await resolveApprovalPaymentIntent({
      personal: personalForReview,
      applicationId,
      tenantId,
      req,
      inlineResolver: async () => {
        const latest = await fetchLatestApplicationPayment(
          applicationId,
          tenantId,
          req,
        );
        return {
          paymentIntentId:
            latest?.paymentIntentId ||
            resolvePaymentIntentId(existingSubscriptionForPayment),
          latestPayment: latest,
        };
      },
    });
    // P5 ownership: the payment captured must be bound to THIS application (fail closed).
    assertApprovalPaymentBinding({ applicationId, paymentIntentId, latestPayment, mode: paymentMode });
    let captureResult = null;
    if (paymentIntentId && paymentState.captured && paymentState.intentId === paymentIntentId) {
      captureResult = { status: "succeeded" }; // captured by an earlier attempt of this row
    } else if (paymentIntentId) {
      const latestPaymentId = latestPayment?.paymentId || latestPayment?.id || latestPayment?._id || null;
      captureResult = await capturePaymentIntent(paymentIntentId, tenantId, req, {
        applicationId,
        actorUserId: reviewerId,
        paymentId: latestPaymentId ? String(latestPaymentId) : null,
      });
      if (captureResult.status === "succeeded") {
        paymentState.captured = true;
        paymentState.intentId = paymentIntentId;
      }
      if (captureResult.status !== "succeeded") {
        throw AppError.conflict("Payment capture did not succeed. Application was not processed.", {
          code: "PAYMENT_CAPTURE_FAILED",
        });
      }
    }

    // Flatten payload for profile storage
    const flattenedProfileFields = flattenProfilePayload(effective);

    let existingProfile = null;
    let linkedUserDocumentId = null;
    let identityLink = null;
    let profile;
    if (
      reviewStatus === DUPLICATE_REVIEW_STATUS.LINKED ||
      reviewStatus === DUPLICATE_REVIEW_STATUS.MERGED
    ) {
      // P5: a LINKED/MERGED review approves INTO the reviewed profile (same tenant, current match),
      // exactly as single approval - never into whichever profile holds the applicant's email.
      const resolved = await resolveProfileForApproval({
        applicationId,
        tenantId,
        effective,
        reviewerId,
        duplicateReview: personalForReview.duplicateReview,
        session,
      });
      profile = resolved.profile;
      existingProfile = profile;
      linkedUserDocumentId = toObjectIdOrNull(resolved.linkedUserId); // null: no rebinding (P5)
      identityLink = resolved.identityLink || null;
      effective = {
        ...resolved.approvalEffective,
        subscriptionDetails: normalizeSubscription(
          resolved.approvalEffective.subscriptionDetails,
          resolved.approvalEffective.professionalDetails,
        ),
      };
    } else {
    if (reviewStatus === DUPLICATE_REVIEW_STATUS.MARKED_NEW) {
      // P5: "Create New Profile" must create one (profiles are unique per tenant+email).
      await assertNoProfileHoldsApplicantEmail(effective.contactInfo, tenantId, session);
    }
    // Find existing profile or create new one
    const email =
      effective.contactInfo?.personalEmail || effective.contactInfo?.workEmail;
    if (!email) throw AppError.badRequest("No email found in effective data", { code: "APPLICANT_EMAIL_REQUIRED" });

    const normalizedEmail = email.toLowerCase();
    existingProfile = await Profile.findOne({
      tenantId,
      normalizedEmail,
    }).session(session);

    // Get userId and userType from effective
    const userId = effective?.userId || null;
    const userType = effective?.userType || null;

    // P5 identity: a portal applicant is bound as themselves; an email match never overrides it.
    const applicantIdentity = await resolveApplicantPortalIdentity({
      tenantId,
      normalizedEmail,
      userType,
      userId,
      session,
    });
    const linkedUserId = applicantIdentity.linkedUserId;
    linkedUserDocumentId = applicantIdentity.linkedUserDocumentId;

    if (existingProfile) {
      // Update existing profile - keep existing membership number
      const updateFields = { ...flattenedProfileFields };

      // P5 identity (owner policy, as findOrCreateProfileByEmail): an EXISTING profile is never
      // bound to the applicant because its email matched. Only a profile already bound to this
      // applicant is updated as that user's own (incl. normalizedEmail); otherwise its identity
      // contact emails / normalizedEmail stay and a pending identity-link request is recorded.
      const applicantIds = [
        linkedUserDocumentId ? String(linkedUserDocumentId) : null,
        linkedUserId ? String(linkedUserId) : null,
      ].filter(Boolean);
      const boundToApplicant =
        !!existingProfile.userId && applicantIds.includes(String(existingProfile.userId));
      if (boundToApplicant) {
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
      } else {
        delete updateFields.normalizedEmail;
        delete updateFields.userId;
        updateFields.contactInfo = preserveIdentityContact(
          existingProfile.contactInfo,
          updateFields.contactInfo || {},
        );
        identityLink = pendingIdentityLink({ profile: existingProfile, applicantIds, applicationId });
      }

      if (!existingProfile.membershipNumber) {
        const membershipNumber = await generateMembershipNumber(existingProfile.tenantId);
        updateFields.membershipNumber = membershipNumber;
        console.log(
          `✅ Generated membership number ${membershipNumber} for existing profile ${existingProfile._id}`
        );
      }

      // crmUserId (the user who approved this profile): set once, never overwritten (P5).
      if (!existingProfile.crmUserId) {
        updateFields.crmUserId = getReviewerIdForDb(reviewerId);
      }

      const beforeLean = existingProfile.toObject({ depopulate: true });
      await Profile.updateOne(
        { _id: existingProfile._id, tenantId },
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

      const beforeSecond = await Profile.findOne({ _id: profile._id, tenantId })
        .session(session)
        .lean();
      await Profile.updateOne(
        { _id: profile._id, tenantId },
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
    }

    const gapLetter = await resolveGapLetterForApproval({
      effective,
      profile,
      tenantId,
      req,
    });
    effective = {
      ...effective,
      subscriptionDetails: {
        ...effective.subscriptionDetails,
        sendGapLetter: gapLetter.sendGapLetter,
      },
    };

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
        "paymentDecision.completedAt": new Date(),
      };
      if (linkedUserDocumentId) {
        personalSet.userId = linkedUserDocumentId;
      }
      if (identityLink) {
        personalSet.identityLink = identityLink;
        await recordPendingIdentityLink(identityLink, {
          tenantId,
          source: "approval.bulk",
          matchedBy: [reviewStatus === "LINKED" || reviewStatus === "MERGED" ? "duplicateReview" : "email"],
          session,
        });
      }
      // P5 fencing: only this run (claim + lease) may write the final state.
      await fencedDecisionUpdate({
        applicationId,
        tenantId,
        decisionClaim,
        update: { $set: personalSet },
        session,
      });
    }

    if (effective.professionalDetails) {
      const profSet = { professionalDetails: effective.professionalDetails };
      if (linkedUserDocumentId) {
        profSet.userId = linkedUserDocumentId;
      }
      await ProfessionalDetails.updateOne(
        { applicationId: applicationId, tenantId },
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
        { applicationId: applicationId, tenantId },
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

    const updatedProfile = await Profile.findOne({
      _id: profile._id,
      tenantId,
    }).session(session);
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
      identityLink: identityLink || null,
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
        gapLetter,
        identityLinkPending: !!identityLink,
      },
    };
}

// Kept in sync with profileApproval.controller.js.
const BULK_TRANSACTION_MAX_ATTEMPTS = 3;
function isTransientTransactionError(error) {
  if (!error) return false;
  if (typeof error.hasErrorLabel === "function") return error.hasErrorLabel("TransientTransactionError");
  if (Array.isArray(error.errorLabels)) return error.errorLabels.includes("TransientTransactionError");
  return error.code === 112 || /write conflict/i.test(error.message || "");
}

function failureRow(applicationId, error) {
  return {
    applicationId,
    status: "failed",
    success: false,
    error: error?.message || "Unknown error",
    code: error?.code && error.code !== "APP_ERROR" ? error.code : null,
    httpStatus: Number.isInteger(error?.status) ? error.status : 500,
  };
}

/**
 * One application of a bulk approval, with the same gates as single approval and its own claim,
 * lease and transaction: a failure (stale review, foreign payment, conflict) fails THIS row only
 * and never takes a payment.
 */
async function bulkApproveOne({ applicationId, tenantId, reviewerId, req, bulkDateJoined, operationKey, itemVersion }) {
  let gatedVersion;
  let opHash = null;
  try {
    const expected = readExpectedReviewVersion(itemVersion);
    // The bulk operation key is bound to each row's decision payload (same key + other payload -> 422).
    opHash = operationHash("bulk-approve", {
      processingDate: req.body?.processingDate ?? null,
      expectedReviewVersion: expected,
    });
    const replay = await findDecisionReplay({
      applicationId,
      tenantId,
      action: "approve",
      operationKey,
      operationHash: opHash,
    });
    if (replay) {
      return { applicationId, profileId: replay.profileId, status: "processed", success: true, replayed: true };
    }
    // Duplicate gate BEFORE the claim and any capture; bound to the version the approver saw.
    const gated = await ensureDuplicateReviewAllowsApproval(applicationId, tenantId);
    gatedVersion = currentReviewVersion(gated);
    assertExpectedReviewVersion(expected, gatedVersion);
  } catch (preError) {
    return failureRow(applicationId, preError);
  }

  // Committed approve decision per row BEFORE any capture (P5 bound payment commands).
  let decisionClaim;
  try {
    decisionClaim = await claimPaymentDecision({
      applicationId,
      tenantId,
      action: "approve",
      actorUserId: reviewerId,
      reviewVersion: gatedVersion,
      operationKey,
      operationHash: opHash,
    });
  } catch (claimError) {
    return failureRow(applicationId, claimError);
  }

  const paymentState = { captured: false };
  const settleClaim = async () => {
    const ids = { applicationId, tenantId, claimId: decisionClaim.claimId, leaseId: decisionClaim.leaseId };
    if (!paymentState.captured) await releasePaymentDecision(ids);
    else await endPaymentDecisionLease(ids);
  };

  let result;
  // Same transient-transaction retry as single approval (a concurrent detection / review write
  // conflicts with this row's lock write); a capture already made is not repeated.
  for (let attempt = 1; attempt <= BULK_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
    const appSession = await mongoose.startSession();
    try {
      appSession.startTransaction();
      result = await approveSingleApplication({
        applicationId,
        tenantId,
        reviewerId,
        req,
        session: appSession,
        bulkDateJoined,
        paymentState,
        gatedVersion,
        decisionClaim,
      });
      await appSession.commitTransaction();
      break;
    } catch (error) {
      // Never commit a partly-applied application: abort, then retry or keep/release the claim.
      if (appSession.inTransaction()) await appSession.abortTransaction().catch(() => {});
      if (isTransientTransactionError(error) && attempt < BULK_TRANSACTION_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 75 * attempt));
        continue;
      }
      await settleClaim();
      return failureRow(applicationId, error);
    } finally {
      appSession.endSession();
    }
  }

  try {
    await publishPostApprovalEvents(result.postApprovalPayload);
  } catch (publishError) {
    // Committed approval: a publish failure never turns it into a failed row (accepted boundary).
    console.error("[bulkApproveApplications] post-approval publish failed", {
      applicationId,
      message: publishError?.message,
    });
  }
  return {
    applicationId,
    profileId: result.profileId,
    status: "processed",
    success: true,
    ...(result.identityLink ? { identityLink: result.identityLink } : {}),
  };
}

async function bulkApproveApplications(req, res, next) {
  const { applicationIds, processingDate } = req.body;
  const tenantId = req.tenantId ? String(req.tenantId) : null;
  if (!tenantId) {
    return next(AppError.forbidden("Tenant context is required"));
  }
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

  // P5 preconditions: one Idempotency-Key per bulk action (428 in enforce mode); per-item versions
  // from `items` (each must be one of applicationIds).
  let operationKey;
  try {
    operationKey = readIdempotencyKey(req);
  } catch (preconditionError) {
    return next(preconditionError);
  }
  const idSet = new Set(applicationIds.map(String));
  const itemVersions = new Map();
  for (const item of Array.isArray(req.body.items) ? req.body.items : []) {
    const id = String(item.applicationId);
    if (!idSet.has(id) || itemVersions.has(id)) {
      return next(
        AppError.badRequest("Every item must name one listed application, once.", { code: "BULK_ITEMS_MISMATCH" }),
      );
    }
    itemVersions.set(id, item.expectedReviewVersion);
  }
  observeDecision("bulk-approval", {
    idempotencyKey: !!operationKey,
    expectedReviewVersion: itemVersions.size >= idSet.size,
    rows: idSet.size,
    rowsWithVersion: [...itemVersions.values()].filter((v) => v !== undefined && v !== null).length,
  });

  const results = [];

  try {
    // Each application: own gate, claim, lease and transaction (one failure never affects others).
    for (const applicationId of applicationIds) {
      results.push(
        await bulkApproveOne({
          applicationId,
          tenantId,
          reviewerId,
          req,
          bulkDateJoined,
          operationKey,
          itemVersion: itemVersions.get(String(applicationId)),
        }),
      );
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

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

const ReviewOverlay = require("../models/reviewOverlay.model.js");
const PersonalDetails = require("../models/personal.details.model.js");
const ProfessionalDetails = require("../models/professional.details.model.js");
const SubscriptionDetails = require("../models/subscription.model.js");
const Profile = require("../models/profile.model.js");
const { APPLICATION_STATUS } = require("../constants/enums.js");
const {
  publishDomainEvent,
  APPLICATION_REVIEW_EVENTS,
} = require("../rabbitMQ/index.js");
const { loadSubmission } = require("../services/submission.service.js");
const { ApplicationApprovalEventPublisher } = require("../rabbitMQ/index.js");
const {
  findOrCreateProfileByEmail,
} = require("../services/profileLookup.service.js");
const { flattenProfilePayload } = require("../helpers/profile.transform.js");

const clone = (o) => JSON.parse(JSON.stringify(o));

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

const pickSubForContract = (s = {}) => ({
  membershipCategory: s?.membershipCategory ?? null,
  membershipStatus: s?.membershipStatus ?? "ACTIVE",
  dateJoined: s?.dateJoined ?? new Date().toISOString().slice(0, 10),
  dateLeft: s?.dateLeft ?? null,
  reasonLeft: s?.reasonLeft ?? null,
  paymentType: s?.paymentType ?? "PAYROLL_DEDUCTION",
  paymentFrequency: s?.paymentFrequency ?? "MONTHLY",
});

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
    normalized.dateJoined = new Date();
  }
  return normalized;
};

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
    const err = new Error(`Patch path not allowed: ${bad.path}`);
    err.status = 400;
    throw err;
  }
  const blocked = patch?.find((op) =>
    op.path.startsWith("/professionalDetails/membershipCategory")
  );
  if (blocked) {
    const err = new Error(
      "membershipCategory must be modified under subscriptionDetails"
    );
    err.status = 400;
    throw err;
  }
}

async function approveApplication(req, res, next) {
  const { applicationId } = req.params;
  const { overlayId, overlayVersion, submission, proposedPatch } = req.body;
  const tenantId = req.tenantId;
  const reviewerId = req.user?.id;

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
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
        await session.abortTransaction();
        return next(AppError.notFound("Overlay not found"));
      }
      if (overlay.overlayVersion !== overlayVersion) {
        await session.abortTransaction();
        return next(AppError.conflict("Overlay version conflict"));
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
      await session.abortTransaction();
      return next(AppError.conflict("Submission changed; refresh and reapply changes."));
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

    // Find existing profile or create new one
    // Check if profile exists before calling findOrCreateProfileByEmail to determine isExistingProfile
    const email =
      effective.contactInfo?.personalEmail || effective.contactInfo?.workEmail;
    if (!email) throw new Error("No email found in effective data");
    const normalizedEmail = email.toLowerCase();
    const existingProfile = await Profile.findOne({
      tenantId,
      normalizedEmail,
    }).session(session);

    // findOrCreateProfileByEmail handles both creation and update with all necessary fields
    const profile = await findOrCreateProfileByEmail({
      tenantId,
      effective,
      reviewerId,
      session,
    });

    // Update main application models with approved data
    if (effective.personalInfo) {
      await PersonalDetails.updateOne(
        { applicationId: applicationId },
        {
          $set: {
            personalInfo: effective.personalInfo,
            contactInfo: effective.contactInfo,
            applicationStatus: "approved",
            "approvalDetails.approvedBy": getReviewerIdForDb(reviewerId),
            "approvalDetails.approvedAt": new Date(),
          },
        },
        { upsert: true, session }
      );
    }

    if (effective.professionalDetails) {
      await ProfessionalDetails.updateOne(
        { applicationId: applicationId },
        { $set: { professionalDetails: effective.professionalDetails } },
        { upsert: true, session }
      );
    }

    if (effective.subscriptionDetails) {
      // Ensure dateJoined is set - use from effective or current date
      const subscriptionDetailsToSave = {
        ...effective.subscriptionDetails,
        dateJoined: effective.subscriptionDetails.dateJoined ?? new Date(),
      };

      await SubscriptionDetails.findOneAndUpdate(
        { applicationId: applicationId },
        { $set: { subscriptionDetails: subscriptionDetailsToSave } },
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

    // Publish events using dedicated publisher
    // Wrap in try-catch to prevent approval failure if publishing fails
    try {
      await ApplicationApprovalEventPublisher.publishApplicationApproved({
        applicationId,
        reviewerId,
        profileId: String(profile._id),
        applicationStatus: "APPROVED",
        isExistingProfile: !!existingProfile,
        effective: {
          personalInfo: effective.personalInfo,
          contactInfo: effective.contactInfo,
          professionalDetails: effective.professionalDetails,
          subscriptionDetails: effective.subscriptionDetails, // Send full subscriptionDetails to preserve all fields (inmoRewards, valueAddedServices, etc.)
        },
        subscriptionAttributes: subAttrs(effective.subscriptionDetails),
        tenantId,
        correlationId: crypto.randomUUID(),
      });
    } catch (publishError) {
      console.error(
        "[approveApplication] Failed to publish application approved event:",
        publishError.message
      );
      // Continue with approval even if publishing fails
    }

    try {
      await ApplicationApprovalEventPublisher.publishMemberCreatedRequested({
        applicationId,
        profileId: String(profile._id),
        isExistingProfile: !!existingProfile,
        effective,
        subscriptionAttributes: subAttrs(effective.subscriptionDetails),
        tenantId,
        correlationId: crypto.randomUUID(),
      });
    } catch (publishError) {
      console.error(
        "[approveApplication] Failed to publish member created requested event:",
        publishError.message
      );
      // Continue with approval even if publishing fails
    }

    // Publish subscription upsert request for subscription-service
    const sub = effective.subscriptionDetails || {};
    // Use dateJoined from the current approval (subscription details), fallback to current date
    // Always use the dateJoined from the approval, not from profile.firstJoinedDate
    const dateJoined = sub.dateJoined ?? new Date();

    // Get userId and userEmail from profile for subscription creation
    const profileWithUser = await Profile.findById(profile._id).session(
      session
    );
    const userIdForSubscription = profileWithUser?.userId
      ? String(profileWithUser.userId)
      : null;
    const userEmailForSubscription =
      effective.contactInfo?.personalEmail ||
      effective.contactInfo?.workEmail ||
      null;

    try {
      await ApplicationApprovalEventPublisher.publishSubscriptionUpsertRequested(
        {
          tenantId,
          profileId: String(profile._id),
          applicationId,
          membershipCategory:
            sub.membershipCategory ??
            effective.professionalDetails?.membershipCategory ??
            null,
          dateJoined: dateJoined,
          paymentType: sub.paymentType ?? null,
          payrollNo: sub.payrollNo ?? null,
          paymentFrequency: sub.paymentFrequency ?? null,
          userId: userIdForSubscription,
          userEmail: userEmailForSubscription,
          reviewerId: reviewerId, // Pass reviewerId (CRM user ID) for meta fields
          correlationId: crypto.randomUUID(),
        }
      );
    } catch (publishError) {
      console.error(
        "[approveApplication] Failed to publish subscription upsert requested event:",
        publishError.message
      );
      // Continue with approval even if publishing fails
    }

    await session.commitTransaction();
    return res.status(200).json({
      applicationId,
      profileId: String(profile._id),
      status: "approved",
      proposedPatch: patchToApply,
    });
  } catch (e) {
    await session.abortTransaction();
    console.error("[approveApplication] Error details:", {
      message: e.message,
      stack: e.stack,
      name: e.name,
      applicationId,
      reviewerId,
      tenantId,
    });
    next(e);
  } finally {
    session.endSession();
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
  const reviewerId = req.user?.id;

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
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

    // Update PersonalDetails with rejection status and details
    await PersonalDetails.updateOne(
      { applicationId: applicationId },
      {
        $set: {
          applicationStatus: APPLICATION_STATUS.REJECTED,
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

    // Publish rejection event for portal-service
    await publishDomainEvent(
      APPLICATION_REVIEW_EVENTS.APPLICATION_REVIEW_REJECTED,
      {
        applicationId,
        reviewerId,
        reason,
        notes,
      },
      { tenantId, correlationId: crypto.randomUUID() }
    );

    await session.commitTransaction();
    return res.status(200).json({ applicationId, status: "rejected" });
  } catch (e) {
    await session.abortTransaction();
    next(e);
  } finally {
    session.endSession();
  }
}

module.exports = { approveApplication, rejectApplication };

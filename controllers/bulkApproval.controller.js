const crypto = require("crypto");
const mongoose = require("mongoose");
const jsonPatch = require("fast-json-patch");
const { applyPatch } = jsonPatch;

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

/**
 * Approve a single application (extracted logic for reuse)
 * This follows the exact same workflow as single approval
 */
async function approveSingleApplication({
  applicationId,
  tenantId,
  reviewerId,
  session,
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

    const { submission: serverSubmission } = await loadSubmission(applicationId);

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

    let profile;
    if (existingProfile) {
      // Update existing profile - keep existing membership number
      const updateFields = { ...flattenedProfileFields };

      // Set userId for portal users when updating existing profile (only if not already set)
      if (userType === "PORTAL" && userId && !existingProfile.userId) {
        updateFields.userId = userId;
      }

      await Profile.updateOne(
        { _id: existingProfile._id },
        {
          $set: updateFields,
        },
        { session }
      );
      profile = existingProfile;
    } else {
      // Create new profile - will get new membership number
      profile = await findOrCreateProfileByEmail({
        tenantId,
        effective,
        reviewerId,
        session,
      });

      // Update Profile with approved data
      const updateFields = { ...flattenedProfileFields };

      // Ensure userId is set for portal users
      if (userType === "PORTAL" && userId) {
        updateFields.userId = userId;
      }

      await Profile.updateOne(
        { _id: profile._id },
        {
          $set: updateFields,
        },
        { session }
      );
    }

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
      const subscriptionDetailsToSave = {
        ...effective.subscriptionDetails,
        dateJoined: effective.subscriptionDetails.dateJoined ?? new Date(),
      };

      await SubscriptionDetails.findOneAndUpdate(
        { applicationId: applicationId },
        { $set: { subscriptionDetails: subscriptionDetailsToSave } },
        { upsert: true, new: true, runValidators: true, session }
      );
    }

    // Close overlay if used
    if (overlay && overlay.status === "open") {
      overlay.status = "decided";
      overlay.decision = "approved";
      overlay.overlayVersion += 1;
      await overlay.save({ session });
    }

    // Publish events (wrapped in try-catch to not fail approval if publishing fails)
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
          subscriptionDetails: pickSubForContract(effective.subscriptionDetails),
        },
        subscriptionAttributes: subAttrs(effective.subscriptionDetails),
        tenantId,
        correlationId: crypto.randomUUID(),
      });
    } catch (publishError) {
      console.error(
        `[bulkApproval] Failed to publish application approved event for ${applicationId}:`,
        publishError.message
      );
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
        `[bulkApproval] Failed to publish member created requested event for ${applicationId}:`,
        publishError.message
      );
    }

    // Publish subscription upsert request
    const sub = effective.subscriptionDetails || {};
    const dateJoined = sub.dateJoined ?? new Date();
    try {
      // Get userId and userEmail from profile for subscription creation
      const profileWithUser = await Profile.findById(profile._id).session(session);
      const userIdForSubscription = profileWithUser?.userId 
        ? String(profileWithUser.userId) 
        : null;
      const userEmailForSubscription = effective.contactInfo?.personalEmail 
        || effective.contactInfo?.workEmail 
        || null;
      
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
          correlationId: crypto.randomUUID(),
        }
      );
    } catch (publishError) {
      console.error(
        `[bulkApproval] Failed to publish subscription upsert requested event for ${applicationId}:`,
        publishError.message
      );
    }

    return {
      applicationId,
      profileId: String(profile._id),
      status: "approved",
      success: true,
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
  const { applicationIds } = req.body;
  const tenantId = req.tenantId;
  const reviewerId = req.user?.id;

  if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
    return res.status(400).json({
      error: "INVALID_REQUEST",
      message: "applicationIds must be a non-empty array",
    });
  }

  // Limit batch size
  if (applicationIds.length > 1000) {
    return res.status(400).json({
      error: "BATCH_SIZE_EXCEEDED",
      message: "Maximum 1000 applications can be approved at once",
    });
  }

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
            session: appSession,
          });

          await appSession.commitTransaction();
          results.push(result);
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
    return res.status(500).json({
      error: "BULK_APPROVAL_ERROR",
      message: error.message,
    });
  }
}

module.exports = { bulkApproveApplications };

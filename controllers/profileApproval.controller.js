const crypto = require("crypto");
const mongoose = require("mongoose");
const jsonPatch = require("fast-json-patch");
const { applyPatch } = jsonPatch;

const ReviewOverlay = require("../models/reviewOverlay.model.js");
const PersonalDetails = require("../models/personal.details.model.js");
const ProfessionalDetails = require("../models/professional.details.model.js");
const SubscriptionDetails = require("../models/subscription.model.js");
const Profile = require("../models/profile.model.js");
const { loadSubmission } = require("../services/submission.service.js");
const { ApplicationApprovalEventPublisher } = require("../rabbitMQ/index.js");
const {
  findOrCreateProfileByEmail,
} = require("../services/profileLookup.service.js");

const clone = (o) => JSON.parse(JSON.stringify(o));

const subAttrs = (s = {}) => ({
  payrollNo: s?.payrollNo ?? null,
  otherIrishTradeUnion: !!s?.otherIrishTradeUnion,
  otherScheme: !!s?.otherScheme,
  recuritedBy: s?.recuritedBy ?? null,
  recuritedByMembershipNo: s?.recuritedByMembershipNo ?? null,
  primarySection: s?.primarySection ?? null,
  otherPrimarySection: s?.otherPrimarySection ?? null,
  secondarySection: s?.secondarySection ?? null,
  otherSecondarySection: s?.otherSecondarySection ?? null,
  incomeProtectionScheme: !!s?.incomeProtectionScheme,
  inmoRewards: !!s?.inmoRewards,
  valueAddedServices: !!s?.valueAddedServices,
  termsAndConditions: s?.termsAndConditions !== false,
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
        return res.status(404).json({ error: "OVERLAY_NOT_FOUND" });
      }
      if (overlay.overlayVersion !== overlayVersion) {
        await session.abortTransaction();
        return res
          .status(409)
          .json({ error: "CONFLICT", message: "Overlay version conflict" });
      }
      patchToApply = overlay.proposedPatch ?? [];
    } else if (submission && proposedPatch) {
      validatePatchPaths(proposedPatch);
      patchToApply = proposedPatch;
    } // else impossible due to validator

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
      return res.status(409).json({
        error: "STALE_SUBMISSION",
        message: "Submission changed; refresh and reapply changes.",
      });
    }

    // Find existing profile or create new one
    const email =
      effective.contactInfo?.personalEmail || effective.contactInfo?.workEmail;
    if (!email) throw new Error("No email found in effective data");

    const normalizedEmail = email.toLowerCase();
    let existingProfile = await Profile.findOne({
      tenantId,
      normalizedEmail,
    }).session(session);

    let profile;
    if (existingProfile) {
      // Update existing profile - keep existing membership number
      await Profile.updateOne(
        { _id: existingProfile._id },
        {
          $set: {
            personalInfo: effective.personalInfo,
            contactInfo: effective.contactInfo,
            professionalDetails: effective.professionalDetails,
            subscriptionAttributes: subAttrs(effective.subscriptionDetails),
            applicationStatus: "APPROVED",
            approvalDetails: {
              approvedBy: reviewerId,
              approvedAt: new Date(),
              effectiveHash: crypto
                .createHash("sha256")
                .update(JSON.stringify(effective))
                .digest("hex"),
              effectiveSnapshot: effective,
            },
          },
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
      await Profile.updateOne(
        { _id: profile._id },
        {
          $set: {
            personalInfo: effective.personalInfo,
            contactInfo: effective.contactInfo,
            professionalDetails: effective.professionalDetails,
            subscriptionAttributes: subAttrs(effective.subscriptionDetails),
            applicationStatus: "APPROVED",
            approvalDetails: {
              approvedBy: reviewerId,
              approvedAt: new Date(),
              effectiveHash: crypto
                .createHash("sha256")
                .update(JSON.stringify(effective))
                .digest("hex"),
              effectiveSnapshot: effective,
            },
          },
        },
        { session }
      );
    }

    // Update main application models with approved data
    if (effective.personalInfo) {
      await PersonalDetails.updateOne(
        { ApplicationId: applicationId },
        {
          $set: {
            personalInfo: effective.personalInfo,
            contactInfo: effective.contactInfo,
            applicationStatus: "approved",
            "approvalDetails.approvedBy": reviewerId,
            "approvalDetails.approvedAt": new Date(),
          },
        },
        { upsert: true, session }
      );
    }

    if (effective.professionalDetails) {
      await ProfessionalDetails.updateOne(
        { ApplicationId: applicationId },
        { $set: { professionalDetails: effective.professionalDetails } },
        { upsert: true, session }
      );
    }

    if (effective.subscriptionDetails) {
      await SubscriptionDetails.updateOne(
        { ApplicationId: applicationId },
        { $set: { subscriptionDetails: effective.subscriptionDetails } },
        { upsert: true, session }
      );
    }

    // Close overlay if used
    if (overlay && overlay.status === "open") {
      overlay.status = "decided";
      overlay.decision = "approved";
      overlay.overlayVersion += 1;
      await overlay.save({ session });
    }

    // Publish events using dedicated publisher
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

    await ApplicationApprovalEventPublisher.publishMemberCreatedRequested({
      applicationId,
      profileId: String(profile._id),
      isExistingProfile: !!existingProfile,
      effective,
      subscriptionAttributes: subAttrs(effective.subscriptionDetails),
      tenantId,
      correlationId: crypto.randomUUID(),
    });

    await session.commitTransaction();
    return res.status(200).json({
      applicationId,
      profileId: String(profile._id),
      status: "approved",
      proposedPatch: patchToApply,
    });
  } catch (e) {
    await session.abortTransaction();
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
        return res.status(404).json({ error: "OVERLAY_NOT_FOUND" });
      }
      if (overlay.overlayVersion !== overlayVersion) {
        await session.abortTransaction();
        return res
          .status(409)
          .json({ error: "CONFLICT", message: "Overlay version conflict" });
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

    // Publish rejection event for portal-service
    await publishDomainEvent(
      APPLICATION_REVIEW_EVENTS.APPLICATION_REVIEW_REJECTED,
      {
        applicationId,
        reviewerId,
        reason,
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

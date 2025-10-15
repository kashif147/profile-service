// services/approval.service.js
const mongoose = require("mongoose");
const jsonPatch = require("fast-json-patch");
const { applyPatch } = jsonPatch;
const crypto = require("crypto");
const ReviewOverlay = require("../models/reviewOverlay.model.js");
const Profile = require("../models/profile.model.js");
const Professional = require("../models/professional.model.js");
const Subscription = require("../models/subscription.model.js");
const { loadSubmission } = require("./submission.service.js");
const {
  publishDomainEvent,
  APPLICATION_REVIEW_EVENTS,
  MEMBERSHIP_EVENTS,
} = require("../rabbitMQ/index.js");
const { APPLICATION_STATUS } = require("../constants/constants.js");

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

async function approveApplication({
  applicationId,
  overlayId,
  overlayVersion,
  reviewerId,
  tenantId,
}) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
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
    const effective = applyPatch(
      deepClone(submission),
      overlay.proposedPatch
    ).newDocument;
    const effectiveHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(effective))
      .digest("hex");

    // 1) Update Profile with effective personal/contact AND approval metadata
    const profileUpdate = {
      personalInfo: effective.personalInfo ?? null,
      contactInfo: effective.contactInfo ?? null,
      applicationStatus: APPLICATION_STATUS.APPROVED,
      approvalDetails: {
        approvedBy: reviewerId,
        approvedAt: new Date(),
        comments: overlay.notes ?? undefined,
      },
    };
    await Profile.updateOne(
      { ApplicationId: applicationId },
      { $set: profileUpdate }
    ).session(session);

    // 2) Update Professional and Subscription from effective
    if (effective.professionalDetails) {
      await Professional.updateOne(
        { ApplicationId: applicationId },
        { $set: { professionalDetails: effective.professionalDetails } },
        { upsert: true, session }
      );
    }

    if (effective.subscriptionDetails) {
      await Subscription.updateOne(
        { ApplicationId: applicationId },
        { $set: { subscriptionDetails: effective.subscriptionDetails } },
        { upsert: true, session }
      );
    }

    // 3) Close overlay (decided)
    overlay.status = "decided";
    overlay.decision = "approved";
    overlay.decisionReason = undefined;
    overlay.overlayVersion += 1;
    await overlay.save({ session });

    // 4) Publish events using shared middleware
    await publishDomainEvent(
      APPLICATION_REVIEW_EVENTS.APPLICATION_REVIEW_APPROVED,
      {
        applicationId,
        reviewerId,
        effectiveHash,
        submissionVersion: undefined, // add if you track versionKey
        overlayVersion: overlay.overlayVersion,
      },
      { tenantId, correlationId: crypto.randomUUID() }
    );

    await publishDomainEvent(
      MEMBERSHIP_EVENTS.MEMBER_CREATED_REQUESTED,
      {
        applicationId,
        effective, // or send only what you need
      },
      { tenantId, correlationId: crypto.randomUUID() }
    );

    await session.commitTransaction();
    return { applicationId, effectiveHash, status: "approved" };
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

    // Update Profile status and approvalDetails
    await Profile.updateOne(
      { ApplicationId: applicationId },
      {
        $set: {
          applicationStatus: "REJECTED",
          approvalDetails: {
            approvedBy: reviewerId,
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
    return { applicationId, status: "rejected" };
  } catch (e) {
    await session.abortTransaction();
    throw e;
  } finally {
    session.endSession();
  }
}

module.exports = { approveApplication, rejectApplication };

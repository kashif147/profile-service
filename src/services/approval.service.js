// services/approval.service.js
import mongoose from "mongoose";
import jsonPatch from "fast-json-patch";
const { applyPatch } = jsonPatch;
import crypto from "crypto";
import ReviewOverlay from "../models/reviewOverlay.model.js";
import Profile from "../models/profile.model.js";
import Professional from "../models/professional.model.js";
import Subscription from "../models/subscription.model.js";
import { loadSubmission } from "./submission.service.js";
import { publishEvent } from "../events/publisher.js"; // your RabbitMQ abstraction
import { APPLICATION_STATUS } from "../constants.js";

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

export async function approveApplication({
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

    // 4) Publish events (outbox pattern in your publisher)
    await publishEvent(
      "applications.review.approved.v1",
      {
        eventId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        tenantId,
        applicationId,
        reviewerId,
        effectiveHash,
        submissionVersion: undefined, // add if you track versionKey
        overlayVersion: overlay.overlayVersion,
      },
      { session }
    );

    await publishEvent(
      "members.member.created.requested.v1",
      {
        // your Membership service can listen and create memberNo, etc.
        eventId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        tenantId,
        applicationId,
        effective, // or send only what you need
      },
      { session }
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

export async function rejectApplication({
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

    await publishEvent(
      "applications.review.rejected.v1",
      {
        eventId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        tenantId,
        applicationId,
        reviewerId,
        reason,
      },
      { session }
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

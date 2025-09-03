import crypto from "crypto";
import mongoose from "mongoose";
import jsonPatch from "fast-json-patch";
const { applyPatch } = jsonPatch;

import ReviewOverlay from "../models/reviewOverlay.model.js";
import Professional from "../models/professional.model.js";
import { loadSubmission } from "../services/submission.service.js";
import { publishEvent } from "../infra/rabbit/publisher.js";
import { findOrCreateProfileByEmail } from "../services/profileLookup.service.js";

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

export async function approveApplication(req, res, next) {
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

    // Find/create Profile by email, then update embedded subscription attributes
    const profile = await findOrCreateProfileByEmail({
      tenantId,
      effective,
      reviewerId,
      session,
    });
    await mongoose.model("Profile").updateOne(
      { _id: profile._id },
      {
        $set: {
          subscriptionAttributes: subAttrs(effective.subscriptionDetails),
        },
      },
      { session }
    );

    // Update Professional (excluding membershipCategory)
    const { membershipCategory, ...profNoCategory } =
      effective.professionalDetails || {};
    if (Object.keys(profNoCategory || {}).length) {
      await Professional.updateOne(
        { tenantId, ApplicationId: applicationId },
        { $set: { professionalDetails: profNoCategory } },
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

    // Publish event for subscription-service
    await publishEvent("applications.review.approved.v1", {
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      tenantId,
      applicationId,
      reviewerId,
      profileId: String(profile._id),
      effective: {
        subscriptionDetails: pickSubForContract(effective.subscriptionDetails),
      },
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

export async function rejectApplication(req, res, next) {
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
    await publishEvent("applications.review.rejected.v1", {
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      tenantId,
      applicationId,
      reviewerId,
      reason,
    });

    await session.commitTransaction();
    return res.status(200).json({ applicationId, status: "rejected" });
  } catch (e) {
    await session.abortTransaction();
    next(e);
  } finally {
    session.endSession();
  }
}

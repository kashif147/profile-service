const crypto = require("crypto");
const jsonPatch = require("fast-json-patch");
const { applyPatch, getValueByPointer } = jsonPatch;

function pathExists(doc, pointer) {
  try {
    return typeof getValueByPointer(doc, pointer) !== "undefined";
  } catch {
    return false;
  }
}
const ReviewOverlay = require("../models/reviewOverlay.model.js");
const { loadSubmission } = require("../services/submission.service.js");

// Optional guard: reject patch paths outside allowed roots
const ALLOWED_PREFIXES = [
  "/personalInfo",
  "/contactInfo",
  "/professionalDetails",
  "/subscriptionDetails",
];
function validatePatchPaths(patch) {
  const bad = patch.find(
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

const clone = (o) => JSON.parse(JSON.stringify(o));

async function saveOverlayDraft(req, res, next) {
  const { applicationId } = req.params;
  const { submission, proposedPatch, effectiveDocument, notes } = req.body;
  const tenantId = req.tenantId;
  const reviewerId = req.user?.id;

  try {
    // Load authoritative submission from portal-service
    const { submission: serverSubmission } = await loadSubmission(
      applicationId
    );

    // Check if submission exists, use client submission as fallback
    let baseSubmission = serverSubmission;
    if (!serverSubmission || Object.keys(serverSubmission).length === 0) {
      console.warn(
        `No submission found for application ${applicationId}, using client submission as base`
      );
      baseSubmission = submission;
    }

    let effective;
    let patchToUse;

    if (effectiveDocument) {
      // Client provided effectiveDocument directly
      effective = effectiveDocument;

      // Generate patch from base submission to effective document
      try {
        patchToUse = jsonPatch.compare(baseSubmission, effective);
      } catch (e) {
        const err = new Error(
          "Failed to generate patch from effectiveDocument"
        );
        err.status = 400;
        throw err;
      }
    } else if (proposedPatch) {
      // Client provided proposedPatch
      try {
        validatePatchPaths(proposedPatch);
      } catch (e) {
        const err = new Error(`Invalid patch paths: ${e.message}`);
        err.status = 400;
        throw err;
      }

      // Validate patch paths exist on the base submission for replace/remove
      const missingPaths = (proposedPatch || [])
        .filter(
          (op) =>
            (op.op === "replace" || op.op === "remove") &&
            !pathExists(baseSubmission, op.path)
        )
        .map((op) => op.path);
      if (missingPaths.length) {
        const err = new Error(
          `Patch path(s) not found on latest submission: ${missingPaths.join(
            ", "
          )}`
        );
        err.status = 409;
        throw err;
      }

      // Try to apply the client-provided patch to the base submission
      try {
        effective = applyPatch(
          clone(baseSubmission),
          proposedPatch,
          true
        ).newDocument;
        patchToUse = proposedPatch;
      } catch (e) {
        // If it doesn't apply, the client likely used a stale submission → ask them to refresh
        const err = new Error(
          "Submission has changed. Please refresh and rebase your patch against the latest server submission."
        );
        err.status = 409;
        throw err;
      }
    } else {
      const err = new Error(
        "Either proposedPatch or effectiveDocument is required"
      );
      err.status = 400;
      throw err;
    }

    // Upsert single open overlay per application
    let overlay = await ReviewOverlay.findOne({
      applicationId,
      status: "open",
    });
    if (!overlay) {
      overlay = new ReviewOverlay({
        overlayId: crypto.randomUUID(),
        applicationId,
        tenantId,
        reviewerId,
        proposedPatch: patchToUse,
        notes,
      });
    } else {
      overlay.proposedPatch = patchToUse;
      overlay.notes = notes ?? overlay.notes;
      overlay.overlayVersion += 1;
    }
    await overlay.save();

    res.status(200).json({
      overlayId: overlay.overlayId,
      overlayVersion: overlay.overlayVersion,
      effective,
      changedPaths: patchToUse.map((p) => p.path),
      proposedPatch: patchToUse,
    });
  } catch (e) {
    next(e);
  }
}

module.exports = { saveOverlayDraft };

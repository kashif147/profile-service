// services/overlay.service.js
const crypto = require("crypto");
const jsonPatch = require("fast-json-patch");
const { compare, applyPatch } = jsonPatch;
const ReviewOverlay = require("../models/reviewOverlay.model.js");
const { loadSubmission } = require("./submission.service.js");

const clone = (o) => JSON.parse(JSON.stringify(o));

async function upsertOverlayFromClientSubmission({
  applicationId,
  tenantId,
  reviewerId,
  clientSubmission, // what CRM posts back
  editedEffectiveDoc, // edited form (effective)
  notes,
}) {
  // 1) Always load authoritative submission from DB
  const { submission: serverSubmission } = await loadSubmission(applicationId);

  // 2) Compute patch using client-passed immutable submission
  let proposedPatch = compare(clientSubmission, editedEffectiveDoc);

  // 3) Try to apply the patch to the authoritative submission
  let effective;
  let rebased = false;
  let changedPaths = proposedPatch.map((p) => p.path);

  try {
    effective = applyPatch(
      clone(serverSubmission),
      proposedPatch,
      /*validate*/ true
    ).newDocument;
  } catch (e) {
    // If paths don’t line up (client stale), rebase patch directly against server submission
    proposedPatch = compare(serverSubmission, editedEffectiveDoc);
    effective = applyPatch(
      clone(serverSubmission),
      proposedPatch,
      true
    ).newDocument;
    changedPaths = proposedPatch.map((p) => p.path);
    rebased = true;
  }

  // 4) Upsert single open overlay
  let overlay = await ReviewOverlay.findOne({ applicationId, status: "open" });
  if (!overlay) {
    overlay = new ReviewOverlay({
      overlayId: crypto.randomUUID(),
      applicationId,
      tenantId,
      reviewerId,
      proposedPatch,
      notes,
    });
  } else {
    overlay.proposedPatch = proposedPatch;
    overlay.notes = notes ?? overlay.notes;
    overlay.overlayVersion += 1;
  }
  await overlay.save();

  return {
    overlayId: overlay.overlayId,
    overlayVersion: overlay.overlayVersion,
    effective,
    changedPaths,
    rebased, // true if we had to recompute patch against server copy
  };
}

async function getEffective(applicationId) {
  const { submission, meta } = await loadSubmission(applicationId);
  const overlay = await ReviewOverlay.findOne({
    applicationId,
    status: "open",
  }).lean();
  const patch = overlay?.proposedPatch ?? [];
  const effective = applyPatch(clone(submission), patch).newDocument;
  const changedPaths = patch.map((p) => p.path);
  return { submission, overlay, effective, changedPaths, meta };
}

module.exports = { upsertOverlayFromClientSubmission, getEffective };

// helpers/overlay.helpers.js
const {
  getEffective,
  upsertOverlayFromClientSubmission,
} = require("../services/overlay.service.js");

async function loadEffectiveForForm({ applicationId }) {
  return await getEffective(applicationId);
}

async function saveOverlayDraftFromForm({
  applicationId,
  tenantId,
  reviewerId,
  submission, // client-passed immutable submission
  effectiveDocument, // edited form
  notes,
}) {
  return await upsertOverlayFromClientSubmission({
    applicationId,
    tenantId,
    reviewerId,
    clientSubmission: submission,
    editedEffectiveDoc: effectiveDocument,
    notes,
  });
}

module.exports = { loadEffectiveForForm, saveOverlayDraftFromForm };

// helpers/overlay.helpers.js
import {
  getEffective,
  upsertOverlayFromClientSubmission,
} from "../services/overlay.service.js";

export async function loadEffectiveForForm({ applicationId }) {
  return await getEffective(applicationId);
}

export async function saveOverlayDraftFromForm({
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

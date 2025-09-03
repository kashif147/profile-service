// controllers/applications.controller.js
import asyncHandler from "../helpers/asyncHandler.js";
import { ok } from "../helpers/http.js";
import {
  loadEffectiveForForm,
  saveOverlayDraftFromForm,
} from "../helpers/overlay.helpers.js";

export const getApplicationForm = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  const payload = await loadEffectiveForForm({ applicationId });
  return ok(res, payload);
});

export const saveReviewDraft = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  const { submission, effectiveDocument, notes } = req.body;
  const tenantId = req.tenantId;
  const reviewerId = req.user?.id;

  const result = await saveOverlayDraftFromForm({
    applicationId,
    tenantId,
    reviewerId,
    submission,
    effectiveDocument,
    notes,
  });
  return ok(res, result);
});

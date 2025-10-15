// controllers/applications.controller.js
const asyncHandler = require("../helpers/asyncHandler.js");
const { ok } = require("../helpers/http.js");
const {
  loadEffectiveForForm,
  saveOverlayDraftFromForm,
} = require("../helpers/overlay.helpers.js");

const getApplicationForm = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  const payload = await loadEffectiveForForm({ applicationId });
  return ok(res, payload);
});

const saveReviewDraft = asyncHandler(async (req, res) => {
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

module.exports = { getApplicationForm, saveReviewDraft };

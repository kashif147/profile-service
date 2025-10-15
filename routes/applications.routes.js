const { Router } = require("express");
const { ensureAuthenticated } = require("../middlewares/auth.js");
const { idempotency } = require("../middlewares/idempotency.js");
const { validate } = require("../middlewares/validate.js");
const { saveOverlayDraft } = require("../controllers/overlay.controller.js");
const {
  approveApplication,
  rejectApplication,
} = require("../controllers/profileApproval.controller.js");
const {
  ReviewDraftBody,
  ApproveBody,
  RejectBody,
} = require("../validation/applications.validators.js");
const { ApplicationParams } = require("../validation/params.validators.js");
const router = Router();

router.post(
  "/:applicationId/review-draft",
  ensureAuthenticated,
  idempotency(),
  validate(ReviewDraftBody),
  saveOverlayDraft
);
router.post(
  "/:applicationId/approve",
  ensureAuthenticated,
  idempotency(),
  validate({ params: ApplicationParams, body: ApproveBody }),
  approveApplication
);
router.post(
  "/:applicationId/reject",
  ensureAuthenticated,
  validate(RejectBody),
  rejectApplication
);

module.exports = router;

import { Router } from "express";
import { ensureAuthenticated } from "../middlewares/auth.js";
import { idempotency } from "../middlewares/idempotency.js";
import { validate } from "../middlewares/validate.js";
import { saveOverlayDraft } from "../controllers/overlay.controller.js";
import {
  approveApplication,
  rejectApplication,
} from "../controllers/profileApproval.controller.js";
import {
  ReviewDraftBody,
  ApproveBody,
  RejectBody,
} from "../validators/applications.validators.js";
import { ApplicationParams } from "../validators/params.validators.js";
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

export default router;

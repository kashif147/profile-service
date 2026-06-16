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
  bulkApproveApplications,
} = require("../controllers/bulkApproval.controller.js");
const {
  updateExecutiveCouncilApproval,
  bulkExecutiveCouncilApproval,
} = require("../controllers/executiveCouncilApproval.controller.js");
const {
  detectDuplicatesForApplication,
  getDuplicateMatches,
  submitDuplicateReviewDecision,
  getDuplicateMergeCompareHandler,
} = require("../controllers/duplicateReview.controller.js");
const {
  ReviewDraftBody,
  ApproveBody,
  RejectBody,
  BulkApprovalBody,
  ExecutiveCouncilApprovalBody,
  BulkExecutiveCouncilApprovalBody,
  DuplicateReviewDecisionBody,
} = require("../validation/applications.validators.js");
const {
  ApplicationParams,
  DuplicateMergeCompareParams,
} = require("../validation/params.validators.js");
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
router.post(
  "/bulk-approval",
  ensureAuthenticated,
  idempotency(),
  validate(BulkApprovalBody),
  bulkApproveApplications
);
router.post(
  "/:applicationId/executive-council-approval",
  ensureAuthenticated,
  idempotency(),
  validate({ params: ApplicationParams, body: ExecutiveCouncilApprovalBody }),
  updateExecutiveCouncilApproval
);
router.post(
  "/bulk-executive-council-approval",
  ensureAuthenticated,
  idempotency(),
  validate(BulkExecutiveCouncilApprovalBody),
  bulkExecutiveCouncilApproval
);

router.post(
  "/:applicationId/detect-duplicates",
  ensureAuthenticated,
  validate({ params: ApplicationParams }),
  detectDuplicatesForApplication
);

router.get(
  "/:applicationId/duplicate-matches",
  ensureAuthenticated,
  validate({ params: ApplicationParams }),
  getDuplicateMatches
);

router.post(
  "/:applicationId/duplicate-review",
  ensureAuthenticated,
  idempotency(),
  validate({ params: ApplicationParams, body: DuplicateReviewDecisionBody }),
  submitDuplicateReviewDecision
);

router.get(
  "/:applicationId/duplicate-merge-compare/:profileId",
  ensureAuthenticated,
  validate({ params: DuplicateMergeCompareParams }),
  getDuplicateMergeCompareHandler
);

module.exports = router;

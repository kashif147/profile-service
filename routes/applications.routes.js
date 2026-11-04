const { Router } = require("express");
const { ensureAuthenticated } = require("../middlewares/auth.js");
const { requireCrm } = require("../middlewares/memberAccess.js");
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

// P5 portal object authorization: approval, rejection, bulk / executive-council approval and the
// duplicate-review tooling are CRM administrative operations (CRM caller + application permission,
// tenant from the trusted context). Owning an application never authorizes deciding it;
// application submission stays on the portal self-service routes.

router.post(
  "/:applicationId/review-draft",
  ensureAuthenticated,
  requireCrm("application", "write"),
  idempotency(),
  validate(ReviewDraftBody),
  saveOverlayDraft
);
router.post(
  "/:applicationId/approve",
  ensureAuthenticated,
  requireCrm("application", "write"),
  idempotency(),
  validate({ params: ApplicationParams, body: ApproveBody }),
  approveApplication
);
router.post(
  "/:applicationId/reject",
  ensureAuthenticated,
  requireCrm("application", "write"),
  validate(RejectBody),
  rejectApplication
);
router.post(
  "/bulk-approval",
  ensureAuthenticated,
  requireCrm("application", "write"),
  idempotency(),
  validate(BulkApprovalBody),
  bulkApproveApplications
);
router.post(
  "/:applicationId/executive-council-approval",
  ensureAuthenticated,
  requireCrm("application", "write"),
  idempotency(),
  validate({ params: ApplicationParams, body: ExecutiveCouncilApprovalBody }),
  updateExecutiveCouncilApproval
);
router.post(
  "/bulk-executive-council-approval",
  ensureAuthenticated,
  requireCrm("application", "write"),
  idempotency(),
  validate(BulkExecutiveCouncilApprovalBody),
  bulkExecutiveCouncilApproval
);

router.post(
  "/:applicationId/detect-duplicates",
  ensureAuthenticated,
  requireCrm("application", "write"),
  validate({ params: ApplicationParams }),
  detectDuplicatesForApplication
);

router.get(
  "/:applicationId/duplicate-matches",
  ensureAuthenticated,
  requireCrm("application", "read"),
  validate({ params: ApplicationParams }),
  getDuplicateMatches
);

router.post(
  "/:applicationId/duplicate-review",
  ensureAuthenticated,
  requireCrm("application", "write"),
  // P5: no body-hash idempotency() here - an identical "Create New Profile" click must not be
  // replayed after the review changed. Explicit Idempotency-Key + review version in the controller.
  validate({ params: ApplicationParams, body: DuplicateReviewDecisionBody }),
  submitDuplicateReviewDecision
);

router.get(
  "/:applicationId/duplicate-merge-compare/:profileId",
  ensureAuthenticated,
  requireCrm("application", "read"),
  validate({ params: DuplicateMergeCompareParams }),
  getDuplicateMergeCompareHandler
);

module.exports = router;

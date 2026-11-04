const {
  runDuplicateDetection,
  getDuplicateReviewState,
  recordDuplicateDecision,
} = require("../services/duplicate.review.service.js");
const {
  getDuplicateMergeCompare,
} = require("../services/duplicate.merge.service.js");
const { DUPLICATE_REVIEW_ACTION } = require("../constants/enums.js");
const { AppError } = require("../errors/AppError.js");
const PersonalDetails = require("../models/personal.details.model.js");
const reviewIdempotency = require("../services/reviewDecisionIdempotency.js");
const { currentReviewVersion } = require("../services/duplicate.review.version.js");
const {
  readIdempotencyKey,
  readExpectedReviewVersion,
  observeDecision,
} = require("../services/decisionPreconditions.js");

async function detectDuplicatesForApplication(req, res, next) {
  try {
    const { applicationId } = req.params;
    const tenantId = req.tenantId;
    if (!tenantId) {
      return next(AppError.badRequest("Tenant context is required"));
    }

    const reviewerId = req.user?.id || req.userId;
    const result = await runDuplicateDetection(
      applicationId,
      tenantId,
      reviewerId,
    );
    return res.success({
      applicationId,
      ...result,
    });
  } catch (error) {
    return next(error);
  }
}

async function getDuplicateMatches(req, res, next) {
  try {
    const { applicationId } = req.params;
    const tenantId = req.tenantId;
    if (!tenantId) {
      return next(AppError.badRequest("Tenant context is required"));
    }

    const result = await getDuplicateReviewState(applicationId, tenantId);
    return res.success({
      applicationId,
      ...result,
    });
  } catch (error) {
    return next(error);
  }
}

async function submitDuplicateReviewDecision(req, res, next) {
  let opKey = null;
  try {
    const { applicationId } = req.params;
    const tenantId = req.tenantId;
    const reviewerId = req.user?.id || req.userId;
    const { action, sourceType, sourceId, decisionReason, mergeFieldChoices, expectedReviewVersion } =
      req.body;

    if (!tenantId) {
      return next(AppError.badRequest("Tenant context is required"));
    }
    if (!reviewerId) {
      return next(AppError.unauthorized("Reviewer identity is required"));
    }
    if (!action || !Object.values(DUPLICATE_REVIEW_ACTION).includes(action)) {
      return next(AppError.badRequest("A valid duplicate review action is required"));
    }
    if (action === DUPLICATE_REVIEW_ACTION.IGNORE_MATCH) {
      return next(
        AppError.badRequest(
          "Ignore is no longer available for application duplicate review. Use Create New Profile for false positive matches."
        )
      );
    }

    // P5: mode-aware preconditions (services/decisionPreconditions.js): malformed -> 400; in
    // DUPLICATE_REVIEW_VERSION_MODE=enforce a missing key / version -> 428.
    const clientKey = readIdempotencyKey(req);
    const expectedVersion = readExpectedReviewVersion(expectedReviewVersion);
    observeDecision("duplicate-review", {
      applicationId,
      idempotencyKey: !!clientKey,
      expectedReviewVersion: expectedVersion !== null,
    });
    // P5: explicit operation idempotency (services/reviewDecisionIdempotency.js).
    const hash = reviewIdempotency.payloadHash(req.body);
    if (clientKey) {
      const key = reviewIdempotency.operationKey({
        tenantId: String(tenantId),
        reviewerId: String(reviewerId),
        applicationId,
        key: clientKey,
      });
      const started = reviewIdempotency.begin(key, hash);
      if (started.kind === "reused") {
        return next(
          new AppError("Idempotency-Key was used with a different decision", 422, "IDEMPOTENCY_KEY_REUSED"),
        );
      }
      if (started.kind === "in_flight") {
        return next(AppError.conflict("This decision is still being processed", { code: "IDEMPOTENCY_IN_FLIGHT" }));
      }
      if (started.kind === "replay") {
        const current = await PersonalDetails.findOne({ applicationId, tenantId: String(tenantId) })
          .select("duplicateReview.reviewVersion")
          .lean();
        const nowVersion = currentReviewVersion(current);
        if (nowVersion !== started.entry.resultVersion) {
          return next(
            AppError.conflict(
              "The duplicate review changed after this decision was recorded. Refresh and review again.",
              { code: "REVIEW_VERSION_CONFLICT", reviewVersion: nowVersion },
            ),
          );
        }
        return res.success({ ...started.entry.response, replayed: true });
      }
      opKey = key;
    }

    const result = await recordDuplicateDecision({
      applicationId,
      tenantId,
      reviewerId,
      action,
      sourceType,
      sourceId,
      decisionReason,
      mergeFieldChoices,
      expectedReviewVersion: expectedVersion,
    });

    const response = { applicationId, ...result };
    if (opKey) {
      reviewIdempotency.complete(opKey, hash, JSON.parse(JSON.stringify(response)), result.reviewVersion);
      opKey = null;
    }
    return res.success(response);
  } catch (error) {
    if (opKey) reviewIdempotency.abandon(opKey);
    return next(error);
  }
}

async function getDuplicateMergeCompareHandler(req, res, next) {
  try {
    const { applicationId, profileId } = req.params;
    const tenantId = req.tenantId;
    if (!tenantId) {
      return next(AppError.badRequest("Tenant context is required"));
    }

    const result = await getDuplicateMergeCompare(
      applicationId,
      profileId,
      tenantId,
      req,
    );
    return res.success(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  detectDuplicatesForApplication,
  getDuplicateMatches,
  submitDuplicateReviewDecision,
  getDuplicateMergeCompareHandler,
};

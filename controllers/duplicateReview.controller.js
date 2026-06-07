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

async function detectDuplicatesForApplication(req, res, next) {
  try {
    const { applicationId } = req.params;
    const tenantId = req.tenantId;
    if (!tenantId) {
      return next(AppError.badRequest("Tenant context is required"));
    }

    const result = await runDuplicateDetection(applicationId, tenantId);
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
  try {
    const { applicationId } = req.params;
    const tenantId = req.tenantId;
    const reviewerId = req.user?.id || req.userId;
    const { action, sourceType, sourceId, decisionReason, mergeFieldChoices } =
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

    const result = await recordDuplicateDecision({
      applicationId,
      tenantId,
      reviewerId,
      action,
      sourceType,
      sourceId,
      decisionReason,
      mergeFieldChoices,
    });

    return res.success({
      applicationId,
      ...result,
    });
  } catch (error) {
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

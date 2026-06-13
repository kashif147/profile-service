const { AppError } = require("../errors/AppError.js");
const {
  detectProfileDuplicates,
  findProfileDuplicateMatches,
} = require("../services/duplicate.detection.service.js");
const {
  getProfileDuplicateMergeCompare,
  executeProfileDuplicateMerge,
  validateMergeFieldChoices,
} = require("../services/duplicate.merge.service.js");

async function detectProfileDuplicatesHandler(req, res, next) {
  try {
    const { profileId } = req.params;
    const tenantId = req.tenantId;
    if (!tenantId) {
      return next(AppError.badRequest("Tenant context is required"));
    }

    const result = await detectProfileDuplicates(profileId, tenantId);
    return res.success({
      profileId,
      ...result,
    });
  } catch (error) {
    return next(error);
  }
}

async function getProfileDuplicateMatches(req, res, next) {
  try {
    const { profileId } = req.params;
    const tenantId = req.tenantId;
    if (!tenantId) {
      return next(AppError.badRequest("Tenant context is required"));
    }

    const result = await findProfileDuplicateMatches(profileId, tenantId);
    return res.success({
      profileId,
      ...result,
    });
  } catch (error) {
    return next(error);
  }
}

async function getProfileDuplicateMergeCompareHandler(req, res, next) {
  try {
    const { profileId, targetProfileId } = req.params;
    const tenantId = req.tenantId;
    const masterProfileId = req.query?.masterProfileId || profileId;
    if (!tenantId) {
      return next(AppError.badRequest("Tenant context is required"));
    }

    const result = await getProfileDuplicateMergeCompare(
      profileId,
      targetProfileId,
      tenantId,
      req,
      { masterProfileId },
    );
    return res.success(result);
  } catch (error) {
    return next(error);
  }
}

async function submitProfileDuplicateMerge(req, res, next) {
  try {
    const { profileId } = req.params;
    const tenantId = req.tenantId;
    const reviewerId = req.user?.id || req.userId;
    const {
      targetProfileId,
      masterProfileId: bodyMasterProfileId,
      absorbedProfileId: bodyAbsorbedProfileId,
      mergeFieldChoices,
    } = req.body || {};

    if (!tenantId) {
      return next(AppError.badRequest("Tenant context is required"));
    }
    if (!reviewerId) {
      return next(AppError.unauthorized("Reviewer identity is required"));
    }

    const masterProfileId = bodyMasterProfileId || profileId;
    const absorbedProfileId =
      bodyAbsorbedProfileId || targetProfileId || null;

    if (!absorbedProfileId) {
      return next(
        AppError.badRequest("absorbedProfileId or targetProfileId is required"),
      );
    }
    validateMergeFieldChoices(mergeFieldChoices);

    const result = await executeProfileDuplicateMerge({
      masterProfileId,
      absorbedProfileId,
      tenantId,
      mergeFieldChoices,
      reviewerId,
      req,
      compareLeftProfileId: profileId,
    });

    return res.success(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  detectProfileDuplicatesHandler,
  getProfileDuplicateMatches,
  getProfileDuplicateMergeCompareHandler,
  submitProfileDuplicateMerge,
};

const mongoose = require("mongoose");
const { AppError } = require("../errors/AppError");
const {
  publishExecutiveCouncilDecision,
  recordExecutiveCouncilDecision,
  recordBulkExecutiveCouncilDecision,
} = require("../services/executiveCouncilApproval.service.js");

async function updateExecutiveCouncilApproval(req, res, next) {
  const { applicationId } = req.params;
  const {
    status = "approved",
    decisionDate,
    comments,
  } = req.body;
  const tenantId = req.tenantId;
  const reviewerId = req.user?.id || req.userId;
  const session = await mongoose.startSession();

  session.startTransaction();
  try {
    const result = await recordExecutiveCouncilDecision({
      applicationId,
      tenantId,
      reviewerId,
      status,
      decisionDate,
      comments,
      session,
    });

    if (!result.success) {
      await session.abortTransaction();
      return next(AppError.badRequest(result.error));
    }

    await session.commitTransaction();
    const { auditPayload, ...responseBody } = result;
    if (auditPayload) {
      await publishExecutiveCouncilDecision(auditPayload);
    }
    return res.status(200).json(responseBody);
  } catch (error) {
    await session.abortTransaction();
    return next(error);
  } finally {
    session.endSession();
  }
}

async function bulkExecutiveCouncilApproval(req, res, next) {
  const {
    applicationIds,
    status = "approved",
    decisionDate,
    comments,
  } = req.body;
  const tenantId = req.tenantId;
  const reviewerId = req.user?.id || req.userId;

  if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
    return next(AppError.badRequest("applicationIds must be a non-empty array"));
  }

  if (applicationIds.length > 1000) {
    return next(
      AppError.badRequest(
        "Maximum 1000 applications can be marked at once",
      ),
    );
  }

  try {
    const result = await recordBulkExecutiveCouncilDecision({
      applicationIds,
      tenantId,
      reviewerId,
      status,
      decisionDate,
      comments,
    });

    return res.status(200).json({
      message: "Executive Council approval processed",
      ...result,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  updateExecutiveCouncilApproval,
  bulkExecutiveCouncilApproval,
};

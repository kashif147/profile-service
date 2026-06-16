const crypto = require("crypto");
const mongoose = require("mongoose");
const { publisher } = require("@projectShell/rabbitmq-middleware");
const PersonalDetails = require("../models/personal.details.model.js");
const { APPLICATION_STATUS } = require("../constants/enums.js");
const { getReviewerIdForDb } = require("../helpers/reviewerIdForDb.js");

const EXECUTIVE_COUNCIL_EVENTS = {
  APPROVED: "applications.executive-council.approved.v1",
  REJECTED: "applications.executive-council.rejected.v1",
};

const ONLY_PROCESSED_MESSAGE =
  "Only processed applications can be marked as Executive Council approved.";

function resolveDecisionDate(decisionDate) {
  return decisionDate ? new Date(decisionDate) : new Date();
}

async function publishExecutiveCouncilDecision({
  applicationId,
  tenantId,
  reviewerId,
  status,
  decisionDate,
  processedAt,
  comments,
}) {
  const eventType =
    status === "rejected"
      ? EXECUTIVE_COUNCIL_EVENTS.REJECTED
      : EXECUTIVE_COUNCIL_EVENTS.APPROVED;

  try {
    await publisher.publish(
      eventType,
      {
        applicationId,
        tenantId: tenantId || null,
        approvedBy: reviewerId || null,
        status,
        decisionDate,
        processedAt,
        comments: comments ?? null,
      },
      {
        tenantId,
        correlationId: crypto.randomUUID(),
        exchange: "application.events",
        routingKey: eventType,
        metadata: {
          service: "profile-service",
          version: "1.0",
          purpose: "audit",
        },
      },
    );
  } catch (error) {
    console.error("[executiveCouncilApproval] publish failed:", {
      applicationId,
      status,
      error: error.message,
    });
  }
}

async function recordExecutiveCouncilDecision({
  applicationId,
  tenantId,
  reviewerId,
  status = "approved",
  decisionDate,
  comments,
  session,
}) {
  const personalDetails = await PersonalDetails.findOne({
    applicationId,
    tenantId: String(tenantId),
  }).session(session);

  if (!personalDetails) {
    return {
      applicationId,
      success: false,
      status: "failed",
      error: "Application not found",
    };
  }

  if (personalDetails.applicationStatus !== APPLICATION_STATUS.PROCESSED) {
    return {
      applicationId,
      success: false,
      status: "skipped",
      error: ONLY_PROCESSED_MESSAGE,
    };
  }

  const processedAt = new Date();
  const resolvedDecisionDate = resolveDecisionDate(decisionDate);

  await PersonalDetails.updateOne(
    { _id: personalDetails._id },
    {
      $set: {
        "executiveCouncilApprovalDetails.status": status,
        "executiveCouncilApprovalDetails.decisionDate": resolvedDecisionDate,
        "executiveCouncilApprovalDetails.approvedBy":
          getReviewerIdForDb(reviewerId),
        "executiveCouncilApprovalDetails.processedAt": processedAt,
        "executiveCouncilApprovalDetails.comments": comments ?? null,
      },
    },
    { session },
  );

  return {
    applicationId,
    success: true,
    status,
    auditPayload: {
      applicationId,
      tenantId,
      reviewerId,
      status,
      decisionDate: resolvedDecisionDate,
      processedAt,
      comments,
    },
  };
}

async function recordBulkExecutiveCouncilDecision({
  applicationIds,
  tenantId,
  reviewerId,
  status = "approved",
  decisionDate,
  comments,
}) {
  const results = [];

  for (const applicationId of applicationIds) {
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
      await session.commitTransaction();
      if (result.auditPayload) {
        await publishExecutiveCouncilDecision(result.auditPayload);
      }
      const { auditPayload, ...publicResult } = result;
      results.push(publicResult);
    } catch (error) {
      await session.abortTransaction();
      results.push({
        applicationId,
        success: false,
        status: "failed",
        error: error.message,
      });
    } finally {
      session.endSession();
    }
  }

  const successful = results.filter((result) => result.success).length;
  const failed = results.length - successful;
  const skipped = results.filter((result) => result.status === "skipped").length;

  return {
    total: applicationIds.length,
    successful,
    failed,
    skipped,
    results,
  };
}

module.exports = {
  ONLY_PROCESSED_MESSAGE,
  publishExecutiveCouncilDecision,
  recordExecutiveCouncilDecision,
  recordBulkExecutiveCouncilDecision,
};

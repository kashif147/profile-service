const { publisher } = require("@projectShell/rabbitmq-middleware");
const {
  DUPLICATE_REVIEW_EVENTS,
} = require("../rabbitMQ/events/duplicate.review.js");

function getMergeFieldDefinitions() {
  try {
    const { MERGE_FIELD_DEFINITIONS } = require("./duplicate.merge.service.js");
    return Array.isArray(MERGE_FIELD_DEFINITIONS) ? MERGE_FIELD_DEFINITIONS : [];
  } catch {
    return [];
  }
}

function cloneForAudit(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function serializeDuplicateReviewState(review) {
  if (!review) return null;
  const plain = review?.toObject?.() ? review.toObject() : { ...review };
  return cloneForAudit(plain);
}

function summarizeMergeFieldChoices(mergeFieldChoices) {
  if (!mergeFieldChoices || typeof mergeFieldChoices !== "object") {
    return [];
  }
  const mergeFieldDefinitions = getMergeFieldDefinitions();
  return Object.entries(mergeFieldChoices).map(([path, source]) => {
    const definition = mergeFieldDefinitions.find((field) => field.path === path);
    return {
      path,
      source,
      label: definition?.label || path,
      sectionLabel: definition?.sectionLabel || null,
    };
  });
}

async function publishDuplicateReviewDecidedAudit({
  tenantId,
  applicationId,
  actorId,
  action,
  sourceType,
  sourceId,
  decisionReason,
  mergeFieldChoices,
  matchScore,
  matchedFields,
  beforeReview,
  afterReview,
  correlationId,
}) {
  if (!tenantId || !applicationId || !action) return { success: false };

  const mergeSelections = summarizeMergeFieldChoices(mergeFieldChoices);
  const matchedProfileId =
    afterReview?.matchedProfileId != null
      ? String(afterReview.matchedProfileId)
      : sourceType === "PROFILE" && sourceId
        ? String(sourceId)
        : null;

  const payload = {
    tenantId: String(tenantId),
    applicationId: String(applicationId),
    action,
    sourceType: sourceType || null,
    sourceId: sourceId != null ? String(sourceId) : null,
    matchedProfileId,
    decisionReason: decisionReason || null,
    duplicateReviewStatus: afterReview?.status || null,
    matchScore: matchScore ?? null,
    matchedFields: Array.isArray(matchedFields) ? matchedFields : [],
    mergeFieldChoices: cloneForAudit(mergeFieldChoices),
    mergeFieldSelections: mergeSelections,
    reviewedBy: actorId != null ? String(actorId) : null,
    reviewedAt: afterReview?.reviewedAt || null,
    before: serializeDuplicateReviewState(beforeReview),
    after: serializeDuplicateReviewState(afterReview),
  };

  try {
    return await publisher.publish(
      DUPLICATE_REVIEW_EVENTS.DUPLICATE_REVIEW_DECIDED,
      payload,
      {
        tenantId: String(tenantId),
        userId: actorId != null ? String(actorId) : undefined,
        correlationId,
        exchange: "application.events",
        routingKey: DUPLICATE_REVIEW_EVENTS.DUPLICATE_REVIEW_DECIDED,
        metadata: {
          service: "profile-service",
          version: "1.0",
          purpose: "audit",
          action,
          mergeFieldCount: mergeSelections.length,
        },
      },
    );
  } catch (err) {
    console.error(
      "[duplicate.review.audit] publish decided failed:",
      err.message,
    );
    return { success: false, error: err.message };
  }
}

async function publishDuplicateDetectionRunAudit({
  tenantId,
  applicationId,
  actorId,
  matchSummary,
  hasPotentialDuplicate,
  duplicateReviewStatus,
  correlationId,
}) {
  if (!tenantId || !applicationId) return { success: false };

  const summary = Array.isArray(matchSummary) ? matchSummary : [];
  const payload = {
    tenantId: String(tenantId),
    applicationId: String(applicationId),
    runBy: actorId != null ? String(actorId) : null,
    duplicateReviewStatus: duplicateReviewStatus || null,
    hasPotentialDuplicate: !!hasPotentialDuplicate,
    matchCount: summary.filter((m) => !m.ignored).length,
    matchingProfilesCount: summary.filter(
      (m) => m.sourceType === "PROFILE" && !m.ignored,
    ).length,
    matchingApplicationsCount: summary.filter(
      (m) => m.sourceType === "APPLICATION" && !m.ignored,
    ).length,
    matchSummary: cloneForAudit(summary),
  };

  try {
    return await publisher.publish(
      DUPLICATE_REVIEW_EVENTS.DUPLICATE_DETECTION_RUN,
      payload,
      {
        tenantId: String(tenantId),
        userId: actorId != null ? String(actorId) : undefined,
        correlationId,
        exchange: "application.events",
        routingKey: DUPLICATE_REVIEW_EVENTS.DUPLICATE_DETECTION_RUN,
        metadata: {
          service: "profile-service",
          version: "1.0",
          purpose: "audit",
        },
      },
    );
  } catch (err) {
    console.error(
      "[duplicate.review.audit] publish detection failed:",
      err.message,
    );
    return { success: false, error: err.message };
  }
}

module.exports = {
  publishDuplicateReviewDecidedAudit,
  publishDuplicateDetectionRunAudit,
  summarizeMergeFieldChoices,
};

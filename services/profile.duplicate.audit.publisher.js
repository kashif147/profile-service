const { publisher } = require("@projectShell/rabbitmq-middleware");
const {
  PROFILE_DUPLICATE_EVENTS,
} = require("../rabbitMQ/events/profile.duplicate.js");
const { summarizeMergeFieldChoices } = require("./duplicate.review.audit.publisher.js");

function cloneForAudit(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function serializeProfileForAudit(profile) {
  if (!profile) return null;
  const plain = profile?.toObject?.() ? profile.toObject({ depopulate: true }) : { ...profile };
  return cloneForAudit(plain);
}

async function publishProfileDuplicateDetectionRunAudit({
  tenantId,
  profileId,
  actorId,
  matchSummary,
  hasPotentialDuplicate,
  correlationId,
}) {
  if (!tenantId || !profileId) return { success: false };

  const summary = Array.isArray(matchSummary) ? matchSummary : [];
  const payload = {
    tenantId: String(tenantId),
    profileId: String(profileId),
    runBy: actorId != null ? String(actorId) : null,
    hasPotentialDuplicate: !!hasPotentialDuplicate,
    matchCount: summary.filter((m) => !m.ignored).length,
    matchingProfilesCount: summary.filter(
      (m) => m.sourceType === "PROFILE" && !m.ignored,
    ).length,
    matchSummary: cloneForAudit(summary),
  };

  try {
    return await publisher.publish(
      PROFILE_DUPLICATE_EVENTS.DETECTION_RUN,
      payload,
      {
        tenantId: String(tenantId),
        userId: actorId != null ? String(actorId) : undefined,
        correlationId,
        exchange: "profile.events",
        routingKey: PROFILE_DUPLICATE_EVENTS.DETECTION_RUN,
        metadata: {
          service: "profile-service",
          version: "1.0",
          purpose: "audit",
        },
      },
    );
  } catch (err) {
    console.error(
      "[profile.duplicate.audit] publish detection failed:",
      err.message,
    );
    return { success: false, error: err.message };
  }
}

async function publishProfileDuplicateMergedAudit({
  tenantId,
  masterProfileId,
  absorbedProfileId,
  actorId,
  mergeFieldChoices,
  beforeMaster,
  beforeAbsorbed,
  afterMaster,
  correlationId,
}) {
  if (!tenantId || !masterProfileId || !absorbedProfileId) {
    return { success: false };
  }

  const mergeSelections = summarizeMergeFieldChoices(mergeFieldChoices);
  const payload = {
    tenantId: String(tenantId),
    profileId: String(masterProfileId),
    masterProfileId: String(masterProfileId),
    absorbedProfileId: String(absorbedProfileId),
    action: "MERGE",
    reviewedBy: actorId != null ? String(actorId) : null,
    mergeFieldChoices: cloneForAudit(mergeFieldChoices),
    mergeFieldSelections: mergeSelections,
    before: {
      master: serializeProfileForAudit(beforeMaster),
      absorbed: serializeProfileForAudit(beforeAbsorbed),
    },
    after: serializeProfileForAudit(afterMaster),
  };

  try {
    return await publisher.publish(PROFILE_DUPLICATE_EVENTS.MERGED, payload, {
      tenantId: String(tenantId),
      userId: actorId != null ? String(actorId) : undefined,
      correlationId,
      exchange: "profile.events",
      routingKey: PROFILE_DUPLICATE_EVENTS.MERGED,
      metadata: {
        service: "profile-service",
        version: "1.0",
        purpose: "audit",
        action: "MERGE",
        mergeFieldCount: mergeSelections.length,
      },
    });
  } catch (err) {
    console.error(
      "[profile.duplicate.audit] publish merged failed:",
      err.message,
    );
    return { success: false, error: err.message };
  }
}

module.exports = {
  publishProfileDuplicateDetectionRunAudit,
  publishProfileDuplicateMergedAudit,
  serializeProfileForAudit,
};

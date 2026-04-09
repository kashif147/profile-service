/**
 * Publishes profile.* events to profile.events for audit-service (and other subscribers).
 * Lazy-loads rabbitMQ to avoid circular deps with profile.model.
 */

function getPublishDomainEvent() {
  const { publishDomainEvent } = require("../rabbitMQ/index.js");
  return publishDomainEvent;
}

function cloneForAudit(obj) {
  if (obj == null) return null;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return null;
  }
}

async function publishProfileAudit(
  eventType,
  {
    tenantId,
    profileId,
    before = null,
    after = null,
    actorId = null,
    source = "profile-service",
    changedPaths = null,
  },
) {
  try {
    if (!tenantId || !profileId) return;
    const publishDomainEvent = getPublishDomainEvent();
    const tid = String(tenantId);
    const pid = String(profileId);
    const data = {
      profileId: pid,
      tenantId: tid,
      source,
      before: cloneForAudit(before),
      after: cloneForAudit(after),
    };
    if (actorId != null) data.actorId = String(actorId);
    if (changedPaths?.length) data.changedPaths = changedPaths;

    await publishDomainEvent(eventType, data, {
      tenantId: tid,
      userId: actorId != null ? String(actorId) : undefined,
      metadata: { source },
    });
  } catch (err) {
    console.error("[profile-audit] publish failed:", err.message);
  }
}

async function publishProfileSaveAudit(doc) {
  const wasNew = doc.$locals.__auditWasNew === true;
  const before = doc.$locals.__auditBefore;
  const actorId = doc.$locals.__auditActorId;
  const eventType =
    doc.$locals.__auditEventType ||
    (wasNew ? "profile.created" : "profile.updated");
  const after = doc.toObject({ depopulate: true });
  const changedPaths = doc.$locals.__auditModifiedPaths;

  await publishProfileAudit(eventType, {
    tenantId: doc.tenantId,
    profileId: doc._id,
    before: wasNew ? null : before,
    after,
    actorId,
    source: doc.$locals.__auditSource || "profile-service",
    changedPaths,
  });
}

/**
 * Call after Profile.updateOne when hooks did not run.
 */
async function publishProfileAfterUpdateOne({
  tenantId,
  profileId,
  beforeLean,
  session,
  actorId,
  source,
}) {
  const Profile = require("../models/profile.model.js");
  const q = Profile.findById(profileId);
  if (session) q.session(session);
  const after = await q.lean();
  if (!after) return;
  await publishProfileAudit("profile.updated", {
    tenantId: tenantId ?? after.tenantId,
    profileId,
    before: beforeLean,
    after,
    actorId,
    source,
  });
}

module.exports = {
  publishProfileAudit,
  publishProfileSaveAudit,
  publishProfileAfterUpdateOne,
  cloneForAudit,
};

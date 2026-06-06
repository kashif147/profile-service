const mongoose = require("mongoose");
const PersonalDetails = require("../models/personal.details.model.js");
const Profile = require("../models/profile.model.js");
const { AppError } = require("../errors/AppError.js");
const {
  DUPLICATE_REVIEW_STATUS,
  DUPLICATE_REVIEW_ACTION,
} = require("../constants/enums.js");
const {
  detectDuplicates,
  findDuplicateMatches,
} = require("./duplicate.detection.service.js");
const {
  findOrCreateProfileByEmail,
  pickPrimaryEmail,
  normalizeEmail,
  findPortalUserIdByTenantEmail,
  resolveLinkedPortalUserIdForProfile,
} = require("./profileLookup.service.js");
const { flattenProfilePayload } = require("../helpers/profile.transform.js");

const APPROVAL_ALLOWED_STATUSES = new Set([
  DUPLICATE_REVIEW_STATUS.NO_MATCH,
  DUPLICATE_REVIEW_STATUS.LINKED,
  DUPLICATE_REVIEW_STATUS.MERGED,
  DUPLICATE_REVIEW_STATUS.MARKED_NEW,
  DUPLICATE_REVIEW_STATUS.IGNORED,
]);

function getReviewerIdForDb(reviewerId) {
  if (reviewerId === "bypass-user") return null;
  return reviewerId;
}

function activeMatchesFromSummary(matchSummary = []) {
  return (matchSummary || []).filter((m) => !m.ignored && m.score >= 40);
}

async function getPersonalDetailsForReview(applicationId) {
  const personal = await PersonalDetails.findOne({ applicationId }).lean();
  if (!personal) {
    throw AppError.notFound("Application not found");
  }
  return personal;
}

async function runDuplicateDetection(applicationId, tenantId) {
  const result = await detectDuplicates(applicationId, tenantId);
  const personal = await getPersonalDetailsForReview(applicationId);
  return {
    ...result,
    duplicateReview: personal.duplicateReview,
    matchingApplications: result.matchingApplications.filter((m) => !m.ignored),
    matchingProfiles: result.matchingProfiles.filter((m) => !m.ignored),
  };
}

async function getDuplicateReviewState(applicationId, tenantId) {
  let personal = await getPersonalDetailsForReview(applicationId);
  const status = personal.duplicateReview?.status || DUPLICATE_REVIEW_STATUS.NOT_CHECKED;

  if (
    status === DUPLICATE_REVIEW_STATUS.NOT_CHECKED ||
    !personal.duplicateReview?.matchSummary?.length
  ) {
    return runDuplicateDetection(applicationId, tenantId);
  }

  const matchSummary = personal.duplicateReview.matchSummary || [];
  return {
    matchingApplications: matchSummary.filter(
      (m) => m.sourceType === "APPLICATION" && !m.ignored,
    ),
    matchingProfiles: matchSummary.filter(
      (m) => m.sourceType === "PROFILE" && !m.ignored,
    ),
    matchSummary,
    hasPotentialDuplicate: activeMatchesFromSummary(matchSummary).length > 0,
    duplicateReview: personal.duplicateReview,
  };
}

function appendAuditEntry(personal, entry) {
  const history = personal.duplicateReview?.auditHistory || [];
  history.push(entry);
  return history;
}

async function recordDuplicateDecision({
  applicationId,
  tenantId,
  reviewerId,
  action,
  sourceType,
  sourceId,
  decisionReason,
}) {
  const personal = await PersonalDetails.findOne({ applicationId });
  if (!personal) {
    throw AppError.notFound("Application not found");
  }

  const now = new Date();
  const matchSummary = [...(personal.duplicateReview?.matchSummary || [])];
  const topMatch = matchSummary.find(
    (m) =>
      m.sourceType === sourceType &&
      String(m.sourceId) === String(sourceId) &&
      !m.ignored,
  );

  const auditEntry = {
    action,
    reviewedBy: getReviewerIdForDb(reviewerId),
    reviewedAt: now,
    matchScore: topMatch?.score ?? null,
    matchedFields: topMatch?.matchedFields || [],
    decisionReason: decisionReason || null,
    sourceType: sourceType || null,
    sourceId: sourceId ? String(sourceId) : null,
  };

  let status = personal.duplicateReview?.status || DUPLICATE_REVIEW_STATUS.NOT_CHECKED;
  let matchedProfileId = personal.duplicateReview?.matchedProfileId || null;
  let matchedApplicationId = personal.duplicateReview?.matchedApplicationId || null;

  if (action === DUPLICATE_REVIEW_ACTION.IGNORE_MATCH) {
    const idx = matchSummary.findIndex(
      (m) =>
        m.sourceType === sourceType && String(m.sourceId) === String(sourceId),
    );
    if (idx >= 0) {
      matchSummary[idx] = { ...matchSummary[idx], ignored: true };
    }
    const remaining = activeMatchesFromSummary(matchSummary);
    status =
      remaining.length > 0
        ? DUPLICATE_REVIEW_STATUS.POTENTIAL_MATCH
        : DUPLICATE_REVIEW_STATUS.IGNORED;
  } else if (action === DUPLICATE_REVIEW_ACTION.MARKED_NEW) {
    status = DUPLICATE_REVIEW_STATUS.MARKED_NEW;
    matchedProfileId = null;
    matchedApplicationId = null;
  } else if (action === DUPLICATE_REVIEW_ACTION.LINK) {
    if (sourceType !== "PROFILE" || !sourceId) {
      throw AppError.badRequest("Link action requires a profile match");
    }
    status = DUPLICATE_REVIEW_STATUS.LINKED;
    matchedProfileId = new mongoose.Types.ObjectId(String(sourceId));
    matchedApplicationId = null;
  } else if (action === DUPLICATE_REVIEW_ACTION.MERGE) {
    if (sourceType !== "PROFILE" || !sourceId) {
      throw AppError.badRequest("Merge action requires a profile match");
    }
    status = DUPLICATE_REVIEW_STATUS.MERGED;
    matchedProfileId = new mongoose.Types.ObjectId(String(sourceId));
    matchedApplicationId = null;
  } else {
    throw AppError.badRequest("Unsupported duplicate review action");
  }

  personal.duplicateReview = {
    ...(personal.duplicateReview?.toObject?.() || personal.duplicateReview || {}),
    status,
    matchedProfileId,
    matchedApplicationId,
    decisionReason: decisionReason || null,
    reviewedBy: getReviewerIdForDb(reviewerId),
    reviewedAt: now,
    matchSummary,
    auditHistory: appendAuditEntry(personal, auditEntry),
  };

  personal.duplicateDetection = {
    ...(personal.duplicateDetection?.toObject?.() || personal.duplicateDetection || {}),
    isPotentialDuplicate: activeMatchesFromSummary(matchSummary).length > 0,
  };

  await personal.save();

  return {
    duplicateReview: personal.duplicateReview,
    hasPotentialDuplicate: personal.duplicateDetection.isPotentialDuplicate,
  };
}

async function ensureDuplicateReviewAllowsApproval(applicationId, tenantId) {
  let personal = await getPersonalDetailsForReview(applicationId);
  let status = personal.duplicateReview?.status || DUPLICATE_REVIEW_STATUS.NOT_CHECKED;

  if (status === DUPLICATE_REVIEW_STATUS.NOT_CHECKED) {
    await detectDuplicates(applicationId, tenantId);
    personal = await getPersonalDetailsForReview(applicationId);
    status = personal.duplicateReview?.status || DUPLICATE_REVIEW_STATUS.NOT_CHECKED;
  }

  if (!APPROVAL_ALLOWED_STATUSES.has(status)) {
    throw AppError.unprocessableEntity(
      "Duplicate review is required before approval. Open Duplicate Profile Review and choose Link, Merge, Create New Profile, or Ignore Match.",
      {
        code: "DUPLICATE_REVIEW_REQUIRED",
        duplicateReviewStatus: status,
        matchCount: activeMatchesFromSummary(
          personal.duplicateReview?.matchSummary,
        ).length,
      },
    );
  }

  return personal;
}

async function applyEffectiveToProfile({ profile, effective, reviewerId, session }) {
  const flattened = flattenProfilePayload(effective);
  const $set = {
    personalInfo: flattened.personalInfo || {},
    contactInfo: flattened.contactInfo || {},
    professionalDetails: flattened.professionalDetails || {},
    preferences: flattened.preferences || {},
    cornMarket: flattened.cornMarket || {},
    additionalInformation: flattened.additionalInformation || {},
    recruitmentDetails: flattened.recruitmentDetails || {},
  };

  const userId = effective?.userId || null;
  const userType = effective?.userType || null;
  const email = pickPrimaryEmail(flattened.contactInfo || {});
  const portalUserId = email
    ? await findPortalUserIdByTenantEmail(
        profile.tenantId,
        normalizeEmail(email),
        session,
      )
    : null;
  const linkedUserId = resolveLinkedPortalUserIdForProfile(
    userType,
    userId,
    portalUserId,
  );

  if (!profile.userId && linkedUserId) {
    $set.userId = linkedUserId;
  }
  if (reviewerId) {
    $set.crmUserId = getReviewerIdForDb(reviewerId);
  }

  const primaryEmail = pickPrimaryEmail({
    ...(profile.contactInfo?.toObject?.() || profile.contactInfo || {}),
    ...(flattened.contactInfo || {}),
  });
  if (primaryEmail) {
    $set.normalizedEmail = normalizeEmail(primaryEmail);
  }

  await Profile.updateOne({ _id: profile._id }, { $set }, { session });
  return Profile.findById(profile._id).session(session);
}

async function resolveProfileForApproval({
  tenantId,
  effective,
  reviewerId,
  duplicateReview,
  session,
}) {
  const status = duplicateReview?.status;

  if (
    status === DUPLICATE_REVIEW_STATUS.LINKED ||
    status === DUPLICATE_REVIEW_STATUS.MERGED
  ) {
    const profileId = duplicateReview.matchedProfileId;
    if (!profileId) {
      throw AppError.badRequest("Duplicate review is missing matched profile");
    }

    let profile = await Profile.findOne({ _id: profileId, tenantId }).session(
      session,
    );
    if (!profile) {
      throw AppError.notFound("Matched profile not found for duplicate review");
    }

    if (status === DUPLICATE_REVIEW_STATUS.MERGED) {
      profile = await applyEffectiveToProfile({
        profile,
        effective,
        reviewerId,
        session,
      });
    } else {
      const patch = {};
      if (reviewerId) patch.crmUserId = getReviewerIdForDb(reviewerId);
      const userId = effective?.userId || null;
      const userType = effective?.userType || null;
      const email = pickPrimaryEmail(effective.contactInfo || {});
      const portalUserId = email
        ? await findPortalUserIdByTenantEmail(
            tenantId,
            normalizeEmail(email),
            session,
          )
        : null;
      const linkedUserId = resolveLinkedPortalUserIdForProfile(
        userType,
        userId,
        portalUserId,
      );
      if (!profile.userId && linkedUserId) patch.userId = linkedUserId;
      if (Object.keys(patch).length > 0) {
        await Profile.updateOne({ _id: profile._id }, { $set: patch }, { session });
        profile = await Profile.findById(profile._id).session(session);
      }
    }

    const linkedUserId = profile.userId || null;
    return { profile, linkedUserId, isExistingProfile: true };
  }

  const email =
    effective.contactInfo?.personalEmail || effective.contactInfo?.workEmail;
  const normalizedEmail = email ? email.toLowerCase() : null;
  const existingProfile =
    normalizedEmail &&
    (await Profile.findOne({ tenantId, normalizedEmail }).session(session));

  const { profile, linkedUserId } = await findOrCreateProfileByEmail({
    tenantId,
    effective,
    reviewerId,
    session,
  });

  return {
    profile,
    linkedUserId,
    isExistingProfile: !!existingProfile,
  };
}

module.exports = {
  runDuplicateDetection,
  getDuplicateReviewState,
  recordDuplicateDecision,
  ensureDuplicateReviewAllowsApproval,
  resolveProfileForApproval,
  activeMatchesFromSummary,
  APPROVAL_ALLOWED_STATUSES,
};

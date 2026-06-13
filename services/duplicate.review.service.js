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
const { loadSubmission } = require("./submission.service.js");
const {
  getReviewerIdForDb,
  toObjectIdOrNull,
} = require("../helpers/reviewerIdForDb.js");
const {
  validateMergeFieldChoices,
  resolveProfileForDuplicateMerge,
  resolveMergedEffectiveForReview,
  applyMergedEffectiveToApplication,
} = require("./duplicate.merge.service.js");
const {
  APPROVAL_ALLOWED_STATUSES,
  DUPLICATE_REVIEW_REQUIRED_MESSAGE,
  isDuplicateReviewBlockingApproval,
} = require("./duplicate.review.helpers.js");
const {
  publishDuplicateReviewDecidedAudit,
} = require("./duplicate.review.audit.publisher.js");

function normalizeMergeFieldChoices(raw) {
  if (!raw) return null;
  if (raw instanceof Map) {
    return Object.fromEntries(raw.entries());
  }
  if (typeof raw.toObject === "function") {
    return raw.toObject();
  }
  if (typeof raw === "object") {
    return raw;
  }
  return null;
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

function normalizeTenantId(tenantId) {
  return String(tenantId || "").trim();
}

function resolveApplicationTenantId(personal, requestTenantId) {
  const applicationTenantId = normalizeTenantId(personal?.tenantId);
  const normalizedRequestTenantId = normalizeTenantId(requestTenantId);

  if (
    normalizedRequestTenantId &&
    applicationTenantId &&
    normalizedRequestTenantId !== applicationTenantId
  ) {
    throw AppError.notFound("Application not found");
  }

  return applicationTenantId || normalizedRequestTenantId;
}

async function runDuplicateDetection(applicationId, tenantId, actorId = null) {
  const personal = await getPersonalDetailsForReview(applicationId);
  const effectiveTenantId = resolveApplicationTenantId(personal, tenantId);
  const result = await detectDuplicates(applicationId, effectiveTenantId, actorId);
  const updatedPersonal = await getPersonalDetailsForReview(applicationId);

  return {
    ...result,
    duplicateReview: updatedPersonal.duplicateReview,
    matchingApplications: result.matchingApplications.filter((m) => !m.ignored),
    matchingProfiles: result.matchingProfiles.filter((m) => !m.ignored),
  };
}

async function getDuplicateReviewState(applicationId, tenantId) {
  let personal = await getPersonalDetailsForReview(applicationId);
  resolveApplicationTenantId(personal, tenantId);
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
  mergeFieldChoices,
}) {
  const personal = await PersonalDetails.findOne({ applicationId });
  if (!personal) {
    throw AppError.notFound("Application not found");
  }

  const effectiveTenantId = resolveApplicationTenantId(personal, tenantId);
  const beforeReview = personal.duplicateReview?.toObject?.()
    ? personal.duplicateReview.toObject()
    : personal.duplicateReview
      ? { ...personal.duplicateReview }
      : null;

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
    for (let i = 0; i < matchSummary.length; i += 1) {
      matchSummary[i] = { ...matchSummary[i], ignored: true };
    }
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
    validateMergeFieldChoices(mergeFieldChoices);
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
    mergeFieldChoices:
      action === DUPLICATE_REVIEW_ACTION.MERGE
        ? normalizeMergeFieldChoices(mergeFieldChoices)
        : null,
    reviewedBy: getReviewerIdForDb(reviewerId),
    reviewedAt: now,
    matchSummary,
    auditHistory: appendAuditEntry(personal, auditEntry),
  };

  personal.duplicateDetection = {
    ...(personal.duplicateDetection?.toObject?.() || personal.duplicateDetection || {}),
    isPotentialDuplicate: activeMatchesFromSummary(matchSummary).length > 0,
  };

  if (action === DUPLICATE_REVIEW_ACTION.MERGE) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      await personal.save({ session });

      const { submission } = await loadSubmission(applicationId);
      const normalizedChoices = normalizeMergeFieldChoices(mergeFieldChoices);
      const { mergedEffective } = await resolveMergedEffectiveForReview({
        applicationId,
        tenantId: effectiveTenantId,
        effective: submission,
        mergeFieldChoices: normalizedChoices,
        matchedProfileId: matchedProfileId,
        requireAuthorizedMatch: true,
      });

      await applyMergedEffectiveToApplication({
        applicationId,
        tenantId: effectiveTenantId,
        effective: mergedEffective,
        session,
      });

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } else {
    await personal.save();
  }

  const afterReview = personal.duplicateReview?.toObject?.()
    ? personal.duplicateReview.toObject()
    : { ...personal.duplicateReview };

  await publishDuplicateReviewDecidedAudit({
    tenantId: effectiveTenantId,
    applicationId,
    actorId: reviewerId,
    action,
    sourceType,
    sourceId,
    decisionReason,
    mergeFieldChoices:
      action === DUPLICATE_REVIEW_ACTION.MERGE ? mergeFieldChoices : null,
    matchScore: auditEntry.matchScore,
    matchedFields: auditEntry.matchedFields,
    beforeReview,
    afterReview,
  });

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

  if (isDuplicateReviewBlockingApproval(status)) {
    throw AppError.unprocessableEntity(DUPLICATE_REVIEW_REQUIRED_MESSAGE, {
      code: "DUPLICATE_REVIEW_REQUIRED",
      duplicateReviewStatus: status,
      matchCount: activeMatchesFromSummary(
        personal.duplicateReview?.matchSummary,
      ).length,
    });
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
    const linkedUserObjectId = toObjectIdOrNull(linkedUserId);
    if (linkedUserObjectId) {
      $set.userId = linkedUserObjectId;
    }
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
  applicationId,
  tenantId,
  effective,
  reviewerId,
  duplicateReview,
  session,
}) {
  const status = duplicateReview?.status;
  let approvalEffective = effective;

  if (
    status === DUPLICATE_REVIEW_STATUS.LINKED ||
    status === DUPLICATE_REVIEW_STATUS.MERGED
  ) {
    const profileId = duplicateReview.matchedProfileId;
    if (!profileId) {
      throw AppError.badRequest("Duplicate review is missing matched profile");
    }

    const { profile: resolvedProfile } = await resolveProfileForDuplicateMerge(
      applicationId,
      profileId,
      tenantId,
      { requireAuthorizedMatch: false },
    );
    let profile = await Profile.findById(resolvedProfile._id).session(session);
    if (!profile) {
      throw AppError.notFound("Matched profile not found for duplicate review");
    }

    if (status === DUPLICATE_REVIEW_STATUS.LINKED) {
      profile = await applyEffectiveToProfile({
        profile,
        effective,
        reviewerId,
        session,
      });
    } else if (status === DUPLICATE_REVIEW_STATUS.MERGED) {
      const mergeFieldChoices = normalizeMergeFieldChoices(
        duplicateReview?.mergeFieldChoices,
      );
      if (
        !mergeFieldChoices ||
        typeof mergeFieldChoices !== "object" ||
        Object.keys(mergeFieldChoices).length === 0
      ) {
        throw AppError.badRequest(
          "Merge review is missing field choices. Re-open merge review and select fields to keep.",
        );
      }

      const { mergedEffective } = await resolveMergedEffectiveForReview({
        applicationId,
        tenantId,
        effective,
        mergeFieldChoices,
        matchedProfileId: profileId,
        requireAuthorizedMatch: false,
      });
      approvalEffective = mergedEffective;

      profile = await applyEffectiveToProfile({
        profile,
        effective: mergedEffective,
        reviewerId,
        session,
      });
    }

    const linkedUserId = profile.userId || null;
    return {
      profile,
      linkedUserId,
      isExistingProfile: true,
      approvalEffective,
    };
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
    approvalEffective,
  };
}

module.exports = {
  runDuplicateDetection,
  getDuplicateReviewState,
  recordDuplicateDecision,
  ensureDuplicateReviewAllowsApproval,
  resolveProfileForApproval,
  activeMatchesFromSummary,
  isDuplicateReviewBlockingApproval,
  APPROVAL_ALLOWED_STATUSES,
  DUPLICATE_REVIEW_REQUIRED_MESSAGE,
};

const mongoose = require("mongoose");
const PersonalDetails = require("../models/personal.details.model.js");
const Profile = require("../models/profile.model.js");
const { AppError } = require("../errors/AppError.js");
const {
  APPLICATION_STATUS,
  DUPLICATE_REVIEW_STATUS,
  DUPLICATE_REVIEW_ACTION,
} = require("../constants/enums.js");
const {
  detectDuplicates,
  findDuplicateMatches,
  applicationInputFingerprint,
} = require("./duplicate.detection.service.js");
const {
  currentReviewVersion,
  reviewVersionFilter,
} = require("./duplicate.review.version.js");
const {
  findOrCreateProfileByEmail,
  pickPrimaryEmail,
  normalizeEmail,
  findPortalUserByTenantEmail,
  resolveLinkedPortalUserIdForProfile,
} = require("./profileLookup.service.js");
const { flattenProfilePayload } = require("../helpers/profile.transform.js");
const {
  generateMembershipNumber,
} = require("../helpers/membership.number.generator.js");
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
  APPLICATION_DUPLICATE_REVIEW_LOCKED_MESSAGE,
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

function isApplicationProcessed(personal) {
  return (
    String(personal?.applicationStatus || "").toLowerCase() ===
    APPLICATION_STATUS.PROCESSED
  );
}

function buildDuplicateReviewState(personal, extras = {}) {
  const duplicateReview =
    personal?.duplicateReview?.toObject?.() || personal?.duplicateReview || {};
  const matchSummary = duplicateReview.matchSummary || [];
  const includeIgnoredMatches = isApplicationProcessed(personal);

  return {
    matchingApplications: matchSummary.filter(
      (m) =>
        m.sourceType === "APPLICATION" && (includeIgnoredMatches || !m.ignored),
    ),
    matchingProfiles: matchSummary.filter(
      (m) => m.sourceType === "PROFILE" && (includeIgnoredMatches || !m.ignored),
    ),
    matchSummary,
    hasPotentialDuplicate: activeMatchesFromSummary(matchSummary).length > 0,
    duplicateReview: {
      status: DUPLICATE_REVIEW_STATUS.NOT_CHECKED,
      ...duplicateReview,
    },
    applicationStatus: personal?.applicationStatus || null,
    isReadOnly: isApplicationProcessed(personal),
    // P5: send back as expectedReviewVersion with the next decision.
    reviewVersion: currentReviewVersion(personal),
    ...extras,
  };
}

function assertApplicationDuplicateReviewMutable(personal) {
  if (isApplicationProcessed(personal)) {
    throw AppError.unprocessableEntity(
      APPLICATION_DUPLICATE_REVIEW_LOCKED_MESSAGE,
      {
        code: "APPLICATION_DUPLICATE_REVIEW_LOCKED",
        applicationStatus: personal.applicationStatus,
      },
    );
  }
}

function normalizeTenantId(tenantId) {
  return String(tenantId || "").trim();
}

function requireRequestTenantId(tenantId) {
  const t = normalizeTenantId(tenantId);
  if (!t) {
    throw AppError.forbidden("Tenant context is required");
  }
  return t;
}

async function getPersonalDetailsForReview(applicationId, tenantId) {
  const personal = await PersonalDetails.findOne({
    applicationId,
    tenantId: requireRequestTenantId(tenantId),
  }).lean();
  if (!personal) {
    throw AppError.notFound("Application not found");
  }
  return personal;
}

/**
 * The trusted request tenant is always authoritative. A missing request tenant
 * is rejected (no "null passes"), and an application owned by a different
 * tenant is indistinguishable from a missing one.
 */
function resolveApplicationTenantId(personal, requestTenantId) {
  const normalizedRequestTenantId = requireRequestTenantId(requestTenantId);
  const applicationTenantId = normalizeTenantId(personal?.tenantId);
  if (applicationTenantId !== normalizedRequestTenantId) {
    throw AppError.notFound("Application not found");
  }
  return normalizedRequestTenantId;
}

async function runDuplicateDetection(applicationId, tenantId, actorId = null) {
  const personal = await getPersonalDetailsForReview(applicationId, tenantId);
  const effectiveTenantId = resolveApplicationTenantId(personal, tenantId);
  assertApplicationDuplicateReviewMutable(personal);
  const result = await detectDuplicates(applicationId, effectiveTenantId, actorId);
  const updatedPersonal = await getPersonalDetailsForReview(
    applicationId,
    effectiveTenantId,
  );

  return {
    ...result,
    duplicateReview: updatedPersonal.duplicateReview,
    applicationStatus: updatedPersonal.applicationStatus || null,
    reviewVersion: currentReviewVersion(updatedPersonal),
    isReadOnly: false,
    matchingApplications: result.matchingApplications.filter((m) => !m.ignored),
    matchingProfiles: result.matchingProfiles.filter((m) => !m.ignored),
  };
}

async function getDuplicateReviewState(applicationId, tenantId) {
  let personal = await getPersonalDetailsForReview(applicationId, tenantId);
  resolveApplicationTenantId(personal, tenantId);
  const status = personal.duplicateReview?.status || DUPLICATE_REVIEW_STATUS.NOT_CHECKED;

  if (
    status === DUPLICATE_REVIEW_STATUS.NOT_CHECKED ||
    !personal.duplicateReview?.matchSummary?.length
  ) {
    if (isApplicationProcessed(personal)) {
      return buildDuplicateReviewState(personal, {
        lockedMessage: APPLICATION_DUPLICATE_REVIEW_LOCKED_MESSAGE,
      });
    }
    return runDuplicateDetection(applicationId, tenantId);
  }

  return buildDuplicateReviewState(personal, {
    lockedMessage: isApplicationProcessed(personal)
      ? APPLICATION_DUPLICATE_REVIEW_LOCKED_MESSAGE
      : undefined,
  });
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
  expectedReviewVersion,
}) {
  if (action === DUPLICATE_REVIEW_ACTION.IGNORE_MATCH) {
    throw AppError.badRequest(
      "Ignore is no longer available for application duplicate review. Use Create New Profile for false positive matches."
    );
  }

  const personal = await PersonalDetails.findOne({
    applicationId,
    tenantId: requireRequestTenantId(tenantId),
  });
  if (!personal) {
    throw AppError.notFound("Application not found");
  }

  const effectiveTenantId = resolveApplicationTenantId(personal, tenantId);
  assertApplicationDuplicateReviewMutable(personal);

  // P5: a decision is bound to the review version the reviewer saw. A stale decision gets 409 and
  // changes nothing. (Callers that do not yet send expectedReviewVersion decide against the current
  // version; the compatibility window is logged.)
  const reviewVersion = currentReviewVersion(personal);
  if (expectedReviewVersion === undefined || expectedReviewVersion === null) {
    console.warn("[duplicate-review] decision without expectedReviewVersion (compatibility window)", {
      applicationId,
      reviewVersion,
    });
  } else if (Number(expectedReviewVersion) !== reviewVersion) {
    throw AppError.conflict(
      "The duplicate review changed since it was loaded. Refresh and review again.",
      { code: "REVIEW_VERSION_CONFLICT", reviewVersion },
    );
  }
  const inputFingerprint = await applicationInputFingerprint(applicationId, effectiveTenantId);
  await assertDecisionTargetValid({
    action,
    sourceType,
    sourceId,
    personal,
    tenantId: effectiveTenantId,
  });

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
    reviewVersion: reviewVersion + 1,
    inputFingerprint,
    invalidatedAt: null,
  };

  personal.duplicateDetection = {
    ...(personal.duplicateDetection?.toObject?.() || personal.duplicateDetection || {}),
    isPotentialDuplicate: activeMatchesFromSummary(matchSummary).length > 0,
  };

  if (action === DUPLICATE_REVIEW_ACTION.MERGE) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      await saveReviewDecision(personal, applicationId, effectiveTenantId, reviewVersion, session);

      const { submission } = await loadSubmission(
        applicationId,
        effectiveTenantId,
      );
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
    await saveReviewDecision(personal, applicationId, effectiveTenantId, reviewVersion, null);
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
    reviewVersion: reviewVersion + 1,
  };
}

/**
 * Compare-and-set the reviewer decision: written only while the review is still at the version the
 * decision was made against and the application is not processed. Otherwise 409, nothing written.
 */
async function saveReviewDecision(personal, applicationId, tenantId, reviewVersion, session) {
  const plain = personal.toObject({ depopulate: true });
  const res = await PersonalDetails.updateOne(
    {
      applicationId,
      tenantId,
      applicationStatus: { $nin: [APPLICATION_STATUS.PROCESSED, APPLICATION_STATUS.REJECTED] },
      ...reviewVersionFilter(reviewVersion),
    },
    {
      $set: {
        duplicateReview: plain.duplicateReview,
        "duplicateDetection.isPotentialDuplicate": !!plain.duplicateDetection?.isPotentialDuplicate,
      },
    },
    session ? { session } : {},
  );
  if (!res.matchedCount) {
    throw AppError.conflict(
      "The duplicate review changed while this decision was being saved. Refresh and review again.",
      { code: "REVIEW_VERSION_CONFLICT" },
    );
  }
}

/**
 * P5: LINK/MERGE must name a profile of the request tenant that is one of the application's current,
 * unignored profile matches. MARKED_NEW (Create New Profile) is refused when a profile in the tenant
 * already holds the applicant's email: profiles are unique per tenant+email, so approval would
 * otherwise silently update that existing profile instead of creating a new one.
 */
async function assertDecisionTargetValid({ action, sourceType, sourceId, personal, tenantId }) {
  if (action === DUPLICATE_REVIEW_ACTION.LINK || action === DUPLICATE_REVIEW_ACTION.MERGE) {
    if (sourceType !== "PROFILE" || !sourceId || !mongoose.Types.ObjectId.isValid(String(sourceId))) {
      throw AppError.badRequest(`${action === DUPLICATE_REVIEW_ACTION.LINK ? "Link" : "Merge"} action requires a profile match`);
    }
    const profile = await Profile.findOne({ _id: String(sourceId), tenantId }).select("_id").lean();
    if (!profile) {
      throw AppError.notFound("Matched profile not found", { code: "MATCHED_PROFILE_NOT_FOUND" });
    }
    const isCurrentMatch = (personal.duplicateReview?.matchSummary || []).some(
      (m) => m.sourceType === "PROFILE" && String(m.sourceId) === String(sourceId) && !m.ignored,
    );
    if (!isCurrentMatch) {
      throw AppError.conflict("The selected profile is not a current match for this application.", {
        code: "MATCH_NOT_CURRENT",
      });
    }
  }
  if (action === DUPLICATE_REVIEW_ACTION.MARKED_NEW) {
    await assertNoProfileHoldsApplicantEmail(personal?.contactInfo, tenantId);
  }
}

async function assertNoProfileHoldsApplicantEmail(contactInfo, tenantId, session = null) {
  const email = pickPrimaryEmail(contactInfo || {});
  const nEmail = email ? normalizeEmail(email) : null;
  if (!nEmail) return;
  const query = Profile.findOne({ tenantId, normalizedEmail: nEmail }).select("_id membershipNumber");
  if (session) query.session(session);
  const existing = await query.lean();
  if (existing) {
    throw AppError.conflict(
      "A profile with this applicant's email already exists. Create New Profile would update that profile; use Tag this Profile or Merge this Profile instead.",
      { code: "PROFILE_EMAIL_EXISTS", existingProfileId: String(existing._id) },
    );
  }
}

async function ensureDuplicateReviewAllowsApproval(applicationId, tenantId) {
  let personal = await getPersonalDetailsForReview(applicationId, tenantId);
  let status = personal.duplicateReview?.status || DUPLICATE_REVIEW_STATUS.NOT_CHECKED;

  if (status === DUPLICATE_REVIEW_STATUS.NOT_CHECKED) {
    await detectDuplicates(applicationId, tenantId);
    personal = await getPersonalDetailsForReview(applicationId, tenantId);
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
  const portalUser = email
    ? await findPortalUserByTenantEmail(
        profile.tenantId,
        normalizeEmail(email),
        session,
      )
    : null;
  const portalUserId = portalUser?.userId || null;
  const portalUserDocumentId = portalUser?._id || null;
  const linkedUserId = resolveLinkedPortalUserIdForProfile(
    userType,
    userId,
    portalUserId,
  );
  const linkedUserDocumentId =
    portalUserDocumentId || toObjectIdOrNull(linkedUserId);

  if (
    linkedUserDocumentId &&
    String(profile.userId || "") !== String(linkedUserDocumentId)
  ) {
    $set.userId = linkedUserDocumentId;
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

  // A profile linked here can be a pre-existing membershipNumber-less record
  // (e.g. events-service's find-or-create-attendee Profile, created with no
  // membership number since attending an event never made someone a member -
  // see events-service's registration-flow.md) that is only now, via this
  // application approval, actually becoming a member. Without this, memberId
  // stays null downstream (approveApplication's memberId = profile.membershipNumber),
  // which breaks the member-created/subscription-upsert events - mirrors the
  // same check bulkApproval.controller.js already has for its own "existing
  // profile" branch.
  if (!profile.membershipNumber) {
    const membershipNumber = await generateMembershipNumber(profile.tenantId);
    $set.membershipNumber = membershipNumber;
    console.log(
      `✅ Generated membership number ${membershipNumber} for existing profile ${profile._id} (duplicate-review LINK)`,
    );
  }

  await Profile.updateOne(
    { _id: profile._id, tenantId: profile.tenantId },
    { $set },
    { session },
  );
  return Profile.findOne({ _id: profile._id, tenantId: profile.tenantId }).session(
    session,
  );
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
    let profile = await Profile.findOne({
      _id: resolvedProfile._id,
      tenantId: requireRequestTenantId(tenantId),
    }).session(session);
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

  // P5: "Create New Profile" must create a new profile. Profiles are unique per tenant+email, so if
  // one already holds the (possibly patched) applicant email, refuse rather than silently updating it.
  if (status === DUPLICATE_REVIEW_STATUS.MARKED_NEW) {
    await assertNoProfileHoldsApplicantEmail(effective.contactInfo, tenantId, session);
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
  assertNoProfileHoldsApplicantEmail,
  assertApplicationDuplicateReviewMutable,
  isApplicationProcessed,
  isDuplicateReviewBlockingApproval,
  APPROVAL_ALLOWED_STATUSES,
  APPLICATION_DUPLICATE_REVIEW_LOCKED_MESSAGE,
  DUPLICATE_REVIEW_REQUIRED_MESSAGE,
};

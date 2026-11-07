const crypto = require("crypto");
const applicationService = require("../services/application.service");
const applicationFilterTemplateService = require("../services/application.filter.template.service");
const { extractUserAndCreatorContext } = require("../helpers/get.user.info.js");
const joischemas = require("../validation/index.js");
const { AppError } = require("../errors/AppError");
const mongoose = require("mongoose");
const { APPLICATION_STATUS } = require("../constants/enums");
const Profile = require("../models/profile.model");
const User = require("../models/user.model.js");
const PersonalDetails = require("../models/personal.details.model.js");
const ProfessionalDetails = require("../models/professional.details.model.js");
const SubscriptionDetails = require("../models/subscription.model.js");
const ApplicationApprovalEventPublisher = require("../rabbitMQ/publishers/application.approval.publisher.js");
const {
  mergeLegacyProfessionalFieldsFromSubscription,
  readLegacyProfessionalFieldsFromSubscriptionRecord,
} = require("../helpers/membershipCategory.helper.js");
const {
  fetchTenantContext,
  resolveTenantTradingName,
} = require("../services/tenant.service.client.js");
const {
  fetchLatestApplicationPayment,
  capturePaymentIntent,
  cancelPaymentIntent,
  normalizePaymentStatus,
} = require("../services/account.service.client.js");
const {
  claimPaymentDecision,
  releasePaymentDecision,
  endPaymentDecisionLease,
  findDecisionReplay,
  lockReviewForDecision,
  fencedDecisionUpdate,
} = require("../services/applicationPaymentDecision.service.js");
const {
  readIdempotencyKey,
  readExpectedReviewVersion,
  assertExpectedReviewVersion,
  observeDecision,
  operationHash,
} = require("../services/decisionPreconditions.js");
const { assertApprovalPaymentBinding } = require("../services/approvalPaymentBinding.js");
const { currentReviewVersion, reviewVersionFilter } = require("../services/duplicate.review.version.js");
const {
  ensureDuplicateReviewAllowsApproval,
  assertReviewedProfileTarget,
} = require("../services/duplicate.review.service.js");
const { resolveApplicationRecipient } = require("../helpers/portalUserIdentity.js");
// const { emitApplicationApproved, emitApplicationRejected } = require("../events/applicationEvents");

function normalizeApplicationTemplateColumns(columns = []) {
  if (!Array.isArray(columns)) return [];

  const normalized = [];
  const seen = new Set();
  columns.forEach((column) => {
    const key =
      column === "professionalDetails.membershipCategory" ||
      column === "subscriptionDetails.membershipCategory"
        ? "membershipCategory"
        : column;
    if (!key || seen.has(key)) return;
    seen.add(key);
    normalized.push(key);
  });
  return normalized;
}

/** True if the client sent at least one non-empty filter entry (not `{}`). */
function requestHasUsableFilters(bodyFilters) {
  if (
    !bodyFilters ||
    typeof bodyFilters !== "object" ||
    Array.isArray(bodyFilters)
  ) {
    return false;
  }
  return Object.values(bodyFilters).some(
    (fe) =>
      fe && Array.isArray(fe.values) && fe.values.length > 0,
  );
}

function parseStatusFilters(rawType) {
  const statusFilters = [];
  if (!rawType) return statusFilters;

  const values = Array.isArray(rawType) ? rawType : [rawType];
  const validStatuses = Object.values(APPLICATION_STATUS);
  for (const v of values) {
    const normalized = typeof v === "string" ? v.toLowerCase().trim() : v;
    if (normalized && validStatuses.includes(normalized)) {
      statusFilters.push(normalized);
    }
  }
  return statusFilters;
}

function resolvePaymentIntentId(subscriptionDetails) {
  return (
    subscriptionDetails?.paymentDetails?.paymentIntentId ||
    subscriptionDetails?.paymentIntentId ||
    null
  );
}

function buildPortalUserIdMatcher(userId) {
  return new mongoose.Types.ObjectId(String(userId));
}

function extractPortalEmail(req) {
  const email =
    req.user?.email ||
    req.headers["x-user-email"] ||
    req.user?.preferred_username ||
    req.user?.preferredEmail;
  if (typeof email !== "string" || !email.trim()) {
    return null;
  }
  return email.trim().toLowerCase();
}

async function resolveProfileIdsForPortalUser(userId, tenantId, email) {
  const profileIds = new Set();
  const tenant = String(tenantId);
  const portalUser =
    userId &&
    (await User.findOne({
      tenantId: tenant,
      userId: String(userId),
      userType: "PORTAL",
      isActive: true,
    })
      .select("_id userEmail")
      .lean());

  const userIdCandidates = [];
  if (portalUser?._id) userIdCandidates.push(portalUser._id);
  if (userId && mongoose.Types.ObjectId.isValid(String(userId))) {
    userIdCandidates.push(buildPortalUserIdMatcher(String(userId)));
  }

  if (userIdCandidates.length > 0) {
    const byUserId = await Profile.find({
      tenantId: tenant,
      userId: { $in: userIdCandidates },
    })
      .select("_id")
      .lean();

    for (const profile of byUserId) {
      profileIds.add(String(profile._id));
    }
  }

  let lookupEmail =
    typeof email === "string" && email.trim()
      ? email.trim().toLowerCase()
      : null;

  if (!lookupEmail && portalUser) {
    lookupEmail = portalUser?.userEmail?.trim()?.toLowerCase() || null;
  }

  if (lookupEmail) {
    const byEmail = await Profile.find({
      tenantId: tenant,
      normalizedEmail: lookupEmail,
    })
      .select("_id")
      .lean();

    for (const profile of byEmail) {
      profileIds.add(String(profile._id));
    }
  }

  return {
    profileIds: [...profileIds],
    lookupEmail,
  };
}

function normalizePersonalDetailsRecord(personalDetails) {
  if (!personalDetails) {
    return null;
  }
  if (typeof personalDetails.toObject === "function") {
    return personalDetails.toObject({ depopulate: true });
  }
  return personalDetails;
}

function personalDetailsMatchesEmail(personalDetails, email) {
  if (!email || !personalDetails?.contactInfo) {
    return false;
  }
  const normalized = email.trim().toLowerCase();
  const personalEmail = personalDetails.contactInfo.personalEmail
    ?.trim()
    ?.toLowerCase();
  const workEmail = personalDetails.contactInfo.workEmail?.trim()?.toLowerCase();
  return personalEmail === normalized || workEmail === normalized;
}

function portalUserOwnsPersonalDetails(
  personalDetails,
  { userId, tenantId, profileIds = [], email = null, lookupEmail = null },
) {
  const personal = normalizePersonalDetailsRecord(personalDetails);
  if (!personal || !tenantId) {
    return false;
  }

  const personalTenantId = personal.tenantId
    ? String(personal.tenantId)
    : null;
  if (personalTenantId && personalTenantId !== String(tenantId)) {
    return false;
  }

  if (userId && personal.userId) {
    const personalUserId = String(personal.userId);
    if (personalUserId === String(userId)) {
      return true;
    }
    if (
      mongoose.Types.ObjectId.isValid(String(userId)) &&
      mongoose.Types.ObjectId.isValid(personalUserId) &&
      new mongoose.Types.ObjectId(String(userId)).equals(personalUserId)
    ) {
      return true;
    }
  }

  if (personal.profileId && profileIds.length > 0) {
    const appProfileId = String(personal.profileId);
    if (profileIds.some((id) => String(id) === appProfileId)) {
      return true;
    }
  }

  for (const addr of [email, lookupEmail]) {
    if (addr && personalDetailsMatchesEmail(personal, addr)) {
      return true;
    }
  }

  return false;
}

// Original GET API - unchanged
exports.getAllApplications = async (req, res, next) => {
  try {
    const { userType, tenantId } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM user can view applications.",
        ),
      );
    }
    if (!tenantId) {
      return next(AppError.forbidden("Tenant context is required"));
    }

    const validatedQuery =
      await joischemas.application_status_query.validateAsync(req.query);

    let statusFilters = [];
    if (validatedQuery.type) {
      if (Array.isArray(validatedQuery.type)) {
        statusFilters = validatedQuery.type;
      } else {
        statusFilters = [validatedQuery.type];
      }
    }

    const page = validatedQuery.page || 1;
    const limit = validatedQuery.limit || 500;

    const paymentStatuses = validatedQuery.paymentStatus
      ? [].concat(validatedQuery.paymentStatus)
      : [];

    const result = await applicationService.getAllApplicationsWithDetails(
      statusFilters,
      page,
      limit,
      tenantId,
      { paymentStatuses },
    );

    return res.success({
      filter: validatedQuery.type || "all",
      applications: result.applications,
      pagination: {
        page: result.pagination.page,
        limit: result.pagination.limit,
        totalCount: result.pagination.totalCount,
        totalPages: result.pagination.totalPages,
        hasNextPage: result.pagination.hasNextPage,
        hasPreviousPage: result.pagination.hasPreviousPage,
      },
    });
  } catch (error) {
    console.error("ApplicationController [getAllApplications] Error:", error);
    if (error.isJoi) {
      return next(AppError.badRequest("Validation error: " + error.message));
    }
    return next(error);
  }
};

// NEW PUT API - Completely separate for template-based filtering
exports.getApplicationsWithTemplate = async (req, res, next) => {
  try {
    const { userType, creatorId, tenantId } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM users can view applications.",
        ),
      );
    }
    if (!tenantId) {
      return next(AppError.forbidden("Tenant context is required"));
    }

    const page = req.body.page ? parseInt(req.body.page) : 1;
    const limit = req.body.limit ? parseInt(req.body.limit) : 500;
    const templateId = req.body.templateId;

    let template;

    // If templateId is provided, fetch and validate the template
    if (templateId) {
      template = await applicationFilterTemplateService.getTemplateById(
        templateId,
        creatorId,
        tenantId || null,
      );

      if (!template) {
        return next(
          AppError.notFound(
            "Template not found or you don't have permission to access it",
          ),
        );
      }
      // This API returns applications; only allow templates of type "application"
      if (template.templateType && template.templateType !== "application") {
        return next(
          AppError.badRequest(
            "This template is not an application template. Use a template with templateType 'application'.",
          ),
        );
      }
    } else {
      // No templateId: use user's default template for application, else system default
      template =
        await applicationFilterTemplateService.getDefaultTemplateForType(
          creatorId,
          "application",
          tenantId || null,
        );
      if (!template) {
        template =
          await applicationFilterTemplateService.getSystemDefaultTemplate(
            "application",
            tenantId || null,
          );
      }
    }

    // Use request filters when the client sent real constraints. An empty object `{}`
    // is truthy in JS and was incorrectly overriding saved template filters (Search /
    // Toolbar often sends `filters: {}` with templateId, which made the list ignore
    // applicationStatus etc. from the template).
    const bodyFilters =
      req.body &&
      req.body.filters &&
      typeof req.body.filters === "object" &&
      !Array.isArray(req.body.filters)
        ? req.body.filters
        : null;
    let filters = requestHasUsableFilters(bodyFilters)
      ? bodyFilters
      : (template.filters || {});

    if (filters.type !== undefined && !filters.applicationStatus) {
      const legacyValues = Array.isArray(filters.type)
        ? filters.type
        : [filters.type];
      filters = {
        ...filters,
        applicationStatus: { operator: "equal_to", values: legacyValues },
      };
    }

    // Use ad-hoc request columns when provided, else template columns.
    const columns = normalizeApplicationTemplateColumns(
      Array.isArray(req.body?.columns) && req.body.columns.length > 0
        ? req.body.columns
        : template.columns || [],
    );

    // Get applications with filters using the NEW service method
    const result = await applicationService.getApplicationsWithTemplateFilters(
      filters,
      page,
      limit,
      columns,
      tenantId,
    );

    return res.success({
      filter: filters,
      columns: columns,
      templateId: template._id,
      isDefault: template.isDefault,
      systemDefault: template.systemDefault || false,
      applications: result.applications,
      pagination: {
        page: result.pagination.page,
        limit: result.pagination.limit,
        totalCount: result.pagination.totalCount,
        totalPages: result.pagination.totalPages,
        hasNextPage: result.pagination.hasNextPage,
        hasPreviousPage: result.pagination.hasPreviousPage,
      },
    });
  } catch (error) {
    console.error(
      "ApplicationController [getApplicationsWithTemplate] Error:",
      error,
    );
    if (error.isJoi) {
      return next(AppError.badRequest("Validation error: " + error.message));
    }
    if (error.message && error.message.includes("not found")) {
      return next(AppError.notFound(error.message));
    }
    return next(error);
  }
};

exports.getApplicationById = async (req, res, next) => {
  try {
    const { userType, userId, tenantId } = extractUserAndCreatorContext(req);
    if (userType !== "CRM" && userType !== "PORTAL") {
      return next(AppError.forbidden("Access denied."));
    }
    const { applicationId } = req.params;
    if (!tenantId) {
      return next(AppError.forbidden("Tenant context is required"));
    }

    const applicationDetails =
      await applicationService.getApplicationWithDetails(
        applicationId,
        tenantId,
      );

    if (!applicationDetails) {
      return res.notFoundRecord("Application not found");
    }

    if (userType === "PORTAL") {
      if (!userId || !tenantId) {
        return next(
          AppError.forbidden(
            "Access denied. You can only view your own applications.",
          ),
        );
      }

      const portalEmail = extractPortalEmail(req);
      const { profileIds, lookupEmail } = await resolveProfileIdsForPortalUser(
        userId,
        tenantId,
        portalEmail,
      );

      const ownsApplication = portalUserOwnsPersonalDetails(
        applicationDetails.personalDetails,
        {
          userId,
          tenantId,
          profileIds,
          email: portalEmail,
          lookupEmail,
        },
      );

      if (!ownsApplication) {
        return next(
          AppError.forbidden(
            "Access denied. You can only view your own applications.",
          ),
        );
      }
    }

    let tradingName = "";
    if (tenantId) {
      const tenantCtx = await fetchTenantContext(tenantId, req);
      tradingName = resolveTenantTradingName(
        tenantCtx.organisationProfile || {},
        { name: tenantCtx.tenantName },
      );
    }

    return res.success({
      ...applicationDetails,
      tradingName,
    });
  } catch (error) {
    console.error("ApplicationController [getApplicationById] Error:", error);
    if (error.message === "Application not found") {
      return res.notFoundRecord("Application not found");
    }
    return next(error);
  }
};

exports.approveApplication = async (req, res, next) => {
  // P5 bound payment commands: committed decision claim before capture/cancel (legacy route too).
  let decisionClaim = null;
  let paymentMoved = false;
  let claimedApplicationId = null;
  let claimedTenantId = null;
  try {
    // Check if user is CRM
    const { userType, creatorId, tenantId } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM users can approve applications.",
        ),
      );
    }

    const { applicationId } = req.params;

    // Validate request body
    const validatedData = await joischemas.application_approve.validateAsync(
      req.body,
    );
    const { comments, applicationStatus } = validatedData;
    const decision = (applicationStatus || "").toLowerCase().trim();
    if (!tenantId) {
      return next(AppError.forbidden("Tenant context is required"));
    }
    // P5 (owner policy: the legacy route is kept, with the SAME guards as the current pipeline):
    // preconditions (enforce: key + version on both decisions), tenant scope, payload-bound
    // operation key + replay, duplicate gate before the claim (approve), reviewed profile target,
    // verified payment binding before any payment mutation, claim + lease, review locked at the
    // gated version before capture, and a fenced final write (claim + lease + version).
    const operationKey = readIdempotencyKey(req);
    // No exemption: the Joi schema admits only processed / rejected, and both require the version.
    const expectedReviewVersion = readExpectedReviewVersion(validatedData.expectedReviewVersion, {
      required: true,
    });
    observeDecision("legacy-status", {
      applicationId,
      idempotencyKey: !!operationKey,
      expectedReviewVersion: expectedReviewVersion !== null,
    });
    // Tenant-scoped existence check BEFORE any payment capture/cancel: an
    // application from another tenant is indistinguishable from a missing one.
    const scopedApplication = await PersonalDetails.findOne({
      applicationId,
      tenantId: String(tenantId),
    })
      .select("_id duplicateReview contactInfo")
      .lean();
    if (!scopedApplication) {
      return res.notFoundRecord("Application not found");
    }
    const claimAction =
      decision === APPLICATION_STATUS.PROCESSED
        ? "approve"
        : decision === APPLICATION_STATUS.REJECTED
          ? "reject"
          : null;
    const opHash = claimAction
      ? operationHash(`legacy-${claimAction}`, { applicationStatus: decision, comments, expectedReviewVersion })
      : null;
    if (claimAction) {
      const replay = await findDecisionReplay({
        applicationId,
        tenantId,
        action: claimAction,
        operationKey,
        operationHash: opHash,
      });
      if (replay) {
        return res.success({ applicationId, applicationStatus: replay.applicationStatus, replayed: true });
      }
    }
    let reviewVersionNow = currentReviewVersion(scopedApplication);
    let reviewedApplication = scopedApplication;
    if (claimAction === "approve") {
      // Duplicate gate BEFORE the claim and any capture (as POST /:applicationId/approve).
      reviewedApplication = await ensureDuplicateReviewAllowsApproval(applicationId, String(tenantId));
      reviewVersionNow = currentReviewVersion(reviewedApplication);
    }
    assertExpectedReviewVersion(expectedReviewVersion, reviewVersionNow);
    if (claimAction === "approve") {
      await assertReviewedProfileTarget({
        duplicateReview: reviewedApplication.duplicateReview,
        effective: { contactInfo: reviewedApplication.contactInfo },
        tenantId: String(tenantId),
      });
    }
    const subscriptionQuery = { applicationId, tenantId: String(tenantId) };
    const existingSubscription = await SubscriptionDetails.findOne(subscriptionQuery)
      .select("paymentDetails")
      .lean();
    const latestPayment = await fetchLatestApplicationPayment(
      applicationId,
      tenantId,
      req,
    );
    const paymentIntentId =
      latestPayment?.paymentIntentId || resolvePaymentIntentId(existingSubscription);
    let paymentActionResult = null;

    // P5 ownership: a payment mutation needs a verified binding to THIS application; a reject
    // with no account payment record proceeds without any payment mutation.
    let mutatePayment = false;
    if (claimAction) {
      ({ mutate: mutatePayment } = assertApprovalPaymentBinding({
        applicationId,
        paymentIntentId,
        latestPayment,
        mode: "INLINE",
        action: claimAction === "approve" ? "capture" : "cancel",
      }));
    }
    if (claimAction) {
      decisionClaim = await claimPaymentDecision({
        applicationId,
        tenantId,
        action: claimAction,
        actorUserId: creatorId,
        operationKey,
        operationHash: opHash,
        ...(claimAction === "approve" ? { reviewVersion: reviewVersionNow } : {}),
      });
      claimedApplicationId = applicationId;
      claimedTenantId = String(tenantId);
    }
    const legacyReviewChanged = () =>
      AppError.conflict(
        paymentMoved
          ? "The duplicate review changed after the payment was captured. Review duplicates again, then approve again (the payment will not be taken twice)."
          : "The duplicate review changed during approval. Review duplicates again, then approve.",
        { code: paymentMoved ? "REVIEW_CHANGED_AFTER_CAPTURE" : "REVIEW_CHANGED", paymentCaptured: paymentMoved },
      );
    if (claimAction === "approve") {
      // Lock: claim + lease + gated review version, BEFORE any capture.
      await lockReviewForDecision({
        applicationId,
        tenantId,
        decisionClaim,
        reviewVersion: reviewVersionNow,
        session: null,
        reviewChanged: legacyReviewChanged,
      });
    }
    const latestPaymentId = latestPayment?.paymentId || latestPayment?.id || latestPayment?._id || null;
    const paymentCommand = {
      applicationId,
      actorUserId: creatorId,
      paymentId: latestPaymentId ? String(latestPaymentId) : null,
    };

    if (mutatePayment && paymentIntentId && decision === APPLICATION_STATUS.PROCESSED) {
      paymentActionResult = await capturePaymentIntent(
        paymentIntentId,
        tenantId,
        req,
        paymentCommand,
      );
      if (paymentActionResult.status === "succeeded") paymentMoved = true;
      if (paymentActionResult.status !== "succeeded") {
        await releasePaymentDecision({ applicationId, tenantId, claimId: decisionClaim?.claimId, leaseId: decisionClaim?.leaseId });
        return next(
          AppError.conflict(
            "Payment capture did not succeed. Application was not approved.",
          ),
        );
      }
    } else if (mutatePayment && paymentIntentId && decision === APPLICATION_STATUS.REJECTED) {
      paymentActionResult = await cancelPaymentIntent(
        paymentIntentId,
        tenantId,
        req,
        paymentCommand,
      );
      paymentMoved = true;
    }

    let updatedApplication;
    if (claimAction) {
      // Fenced final write: this run's claim + lease (and, approving, the gated review version).
      const active = decision === APPLICATION_STATUS.PROCESSED;
      await fencedDecisionUpdate({
        applicationId,
        tenantId,
        decisionClaim,
        extraFilter: claimAction === "approve" ? reviewVersionFilter(reviewVersionNow) : {},
        onOtherMiss: legacyReviewChanged,
        update: {
          $set: {
            applicationStatus: decision,
            approvalDetails: { approvedBy: creatorId, approvedAt: new Date(), comments: comments || "" },
            "meta.isActive": active,
            "paymentDecision.completedAt": new Date(),
          },
        },
      });
      await ProfessionalDetails.updateMany(subscriptionQuery, { $set: { "meta.isActive": active } });
      await SubscriptionDetails.updateMany(subscriptionQuery, { $set: { "meta.isActive": active } });
      updatedApplication = await PersonalDetails.findOne(subscriptionQuery).lean();
    } else {
      // Use the application service
      updatedApplication = await applicationService.updateApplicationStatus(
        applicationId,
        applicationStatus,
        creatorId,
        comments,
        tenantId,
      );
    }

    if (mutatePayment && paymentIntentId && paymentActionResult?.status) {
      await SubscriptionDetails.updateOne(
        { applicationId, tenantId: String(tenantId) },
        {
          $set: {
            paymentDetails: {
              ...(existingSubscription?.paymentDetails || {}),
              paymentIntentId,
              status:
                decision === APPLICATION_STATUS.PROCESSED
                  ? "Captured"
                  : normalizePaymentStatus(paymentActionResult.status),
              attemptNumber: latestPayment?.attemptNumber,
              updatedAt: new Date(),
            },
          },
        },
      );
    }
    if (decision === APPLICATION_STATUS.PROCESSED) {
      try {
        const [personal, professional, subscription] = await Promise.all([
          PersonalDetails.findOne({ applicationId, tenantId: String(tenantId) }).lean(),
          ProfessionalDetails.findOne({ applicationId, tenantId: String(tenantId) }).lean(),
          SubscriptionDetails.findOne({ applicationId, tenantId: String(tenantId) }).lean(),
        ]);
        const profileDoc =
          personal?.profileId &&
          mongoose.Types.ObjectId.isValid(String(personal.profileId))
            ? await Profile.findOne({
                _id: personal.profileId,
                tenantId: String(tenantId),
              }).lean()
            : null;
        const legacyProfessionalFields =
          await readLegacyProfessionalFieldsFromSubscriptionRecord(subscription);
        const effective = {
          personalInfo: personal?.personalInfo,
          contactInfo: personal?.contactInfo,
          professionalDetails: mergeLegacyProfessionalFieldsFromSubscription(
            professional?.professionalDetails || {},
            legacyProfessionalFields,
          ),
          subscriptionDetails: subscription?.subscriptionDetails,
        };
        const sub = subscription?.subscriptionDetails || {};
        const userEmail =
          personal?.contactInfo?.personalEmail ||
          personal?.contactInfo?.workEmail ||
          null;
        // P5 identity: portal applicant = verified submitter; none while an identity link is pending.
        const { userId: notificationUserId, applicantIdentity } = await resolveApplicationRecipient({
          tenantId,
          submitterUserId: personal?.userId,
          submitterUserType: personal?.meta?.userType,
          profileUserId: profileDoc?.userId,
          linkedUserId: personal?.userId,
          userEmail,
          identityLinkPending: personal?.identityLink?.status === "PENDING",
        });
        try {
          await ApplicationApprovalEventPublisher.publishApplicationApproved({
            applicationId,
            reviewerId: creatorId,
            profileId: personal?.profileId ? String(personal.profileId) : null,
            applicationStatus: APPLICATION_STATUS.PROCESSED,
            isExistingProfile: !!profileDoc,
            crmUserId: profileDoc?.crmUserId
              ? String(profileDoc.crmUserId)
              : null,
            memberId: profileDoc?.membershipNumber || null,
            userId: notificationUserId,
            applicantIdentity,
            userEmail,
            effective: {
              personalInfo: effective.personalInfo,
              contactInfo: effective.contactInfo,
              professionalDetails: effective.professionalDetails,
              subscriptionDetails: effective.subscriptionDetails,
            },
            subscriptionAttributes: {
              payrollNo: sub?.payrollNo ?? null,
              paymentFrequency: sub?.paymentFrequency ?? null,
              otherIrishTradeUnion: !!sub?.otherIrishTradeUnion,
              otherIrishTradeUnionName: sub?.otherIrishTradeUnionName ?? null,
              otherScheme: !!sub?.otherScheme,
              recuritedBy: sub?.recuritedBy ?? null,
              recuritedByMembershipNo: sub?.recuritedByMembershipNo ?? null,
              confirmedRecruiterProfileId: sub?.confirmedRecruiterProfileId ?? null,
              primarySection: sub?.primarySection ?? null,
              otherPrimarySection: sub?.otherPrimarySection ?? null,
              secondarySection: sub?.secondarySection ?? null,
              otherSecondarySection: sub?.otherSecondarySection ?? null,
              incomeProtectionScheme: !!sub?.incomeProtectionScheme,
              inmoRewards: !!sub?.inmoRewards,
              valueAddedServices: !!sub?.valueAddedServices,
              termsAndConditions: sub?.termsAndConditions !== false,
              membershipCategory: sub?.membershipCategory ?? null,
              membershipStatus: sub?.membershipStatus ?? null,
              dateJoined: sub?.dateJoined ?? null,
              submissionDate: sub?.submissionDate ?? null,
              dateLeft: sub?.dateLeft ?? null,
              reasonLeft: sub?.reasonLeft ?? null,
            },
            tenantId: tenantId != null ? String(tenantId) : null,
            correlationId: crypto.randomUUID(),
          });
        } catch (publishError) {
          console.error(
            "[processApplication] Failed to publish application processed event:",
            publishError.message,
          );
        }

        if (personal?.profileId && subscription?.subscriptionDetails) {
          try {
            await ApplicationApprovalEventPublisher.publishSubscriptionUpsertRequested({
              tenantId: tenantId != null ? String(tenantId) : null,
              profileId: String(personal.profileId),
              applicationId,
              memberId: profileDoc?.membershipNumber || null,
              membershipCategory:
                sub?.membershipCategory ??
                effective.professionalDetails?.membershipCategory ??
                null,
              dateJoined: sub?.dateJoined ?? new Date(),
              submissionDate: sub?.submissionDate ?? null,
              applicationDate: sub?.applicationDate ?? effective.applicationDate ?? null,
              paymentType: sub?.paymentType ?? null,
              payrollNo: sub?.payrollNo ?? null,
              paymentFrequency: sub?.paymentFrequency ?? null,
              userId: notificationUserId,
              applicantIdentity,
              userEmail,
              reviewerId: creatorId,
              deactivatePreviousSubscriptionStatus: profileDoc
                ? "Cancelled"
                : undefined,
              correlationId: crypto.randomUUID(),
            });
          } catch (publishError) {
            console.error(
              "[processApplication] Failed to publish subscription upsert event:",
              publishError.message,
            );
          }
        }
      } catch (publishError) {
        console.error(
          "[processApplication] Failed to prepare processed-application side effects:",
          publishError.message,
        );
      }
    } else if (decision === APPLICATION_STATUS.REJECTED) {
      try {
        const personal = await PersonalDetails.findOne({
          applicationId,
          tenantId: String(tenantId),
        })
          .select("userId contactInfo meta.userType")
          .lean();
        const userEmail =
          personal?.contactInfo?.personalEmail ||
          personal?.contactInfo?.workEmail ||
          null;
        // P5 identity: a portal applicant is notified as themselves, never via an email match.
        const { userId: notificationUserId, applicantIdentity } = await resolveApplicationRecipient({
          tenantId,
          submitterUserId: personal?.userId,
          submitterUserType: personal?.meta?.userType,
          profileUserId: personal?.userId,
          linkedUserId: personal?.userId,
          userEmail,
        });
        await ApplicationApprovalEventPublisher.publishApplicationRejected({
          applicationId,
          reviewerId: creatorId,
          reason: comments || null,
          notes: null,
          tenantId: tenantId != null ? String(tenantId) : null,
          userId: notificationUserId,
          applicantIdentity,
          correlationId: crypto.randomUUID(),
        });
      } catch (publishError) {
        console.error(
          "[approveApplication] Failed to publish application rejected event:",
          publishError.message,
        );
      }
    }

    return res.success({
      applicationId: updatedApplication.applicationId,
      applicationStatus: updatedApplication.applicationStatus,
      approvalDetails: updatedApplication.approvalDetails,
    });
  } catch (error) {
    if (decisionClaim && !paymentMoved) {
      await releasePaymentDecision({
        applicationId: claimedApplicationId,
        tenantId: claimedTenantId,
        claimId: decisionClaim.claimId,
        leaseId: decisionClaim.leaseId,
      });
    } else if (decisionClaim) {
      // Money moved: keep the claim, end this run's lease so the same action can be re-run.
      await endPaymentDecisionLease({
        applicationId: claimedApplicationId,
        tenantId: claimedTenantId,
        claimId: decisionClaim.claimId,
        leaseId: decisionClaim.leaseId,
      });
    }
    console.error("ApplicationController [approveApplication] Error:", error);
    if (error.isJoi) {
      return next(AppError.badRequest("Validation error: " + error.message));
    }
    if (error.message.includes("Invalid status")) {
      return next(AppError.badRequest(error.message));
    }
    if (error.message.includes("Application not found")) {
      return res.notFoundRecord("Application not found");
    }
    return next(error);
  }
};

exports.getApplicationsByProfileId = async (req, res, next) => {
  try {
    const { userType, userId, tenantId } = extractUserAndCreatorContext(req);

    const { profileId } = req.params;

    if (!profileId || !mongoose.Types.ObjectId.isValid(profileId)) {
      return next(AppError.badRequest("Invalid profileId"));
    }

    if (userType !== "CRM" && userType !== "PORTAL") {
      return next(AppError.forbidden("Access denied."));
    }

    if (userType === "PORTAL") {
      if (!userId || !tenantId) {
        return next(AppError.forbidden("Access denied."));
      }
      if (!mongoose.Types.ObjectId.isValid(String(userId))) {
        return next(
          AppError.forbidden(
            "Access denied. You can only view your own applications.",
          ),
        );
      }
      const portalUser = await User.findOne({
        tenantId: String(tenantId),
        userId: String(userId),
        userType: "PORTAL",
        isActive: true,
      })
        .select("_id")
        .lean();
      const userIdCandidates = [buildPortalUserIdMatcher(String(userId))];
      if (portalUser?._id) userIdCandidates.push(portalUser._id);
      const ownsProfile = await Profile.exists({
        _id: new mongoose.Types.ObjectId(profileId),
        tenantId: String(tenantId),
        userId: { $in: userIdCandidates },
      });
      if (!ownsProfile) {
        return next(
          AppError.forbidden(
            "Access denied. You can only view your own applications.",
          ),
        );
      }
    }

    const statusFilters = parseStatusFilters(req.query.type);
    if (!tenantId) {
      return next(AppError.forbidden("Tenant context is required"));
    }
    const applications = await applicationService.getApplicationsByProfileId(
      profileId,
      statusFilters,
      tenantId,
    );

    return res.success({
      profileId,
      count: applications.length,
      applications,
    });
  } catch (error) {
    console.error(
      "ApplicationController [getApplicationsByProfileId] Error:",
      error?.message || error,
    );
    if (error?.stack) console.error(error.stack);
    if (error?.message?.includes("Profile ID is required")) {
      return next(AppError.badRequest(error.message));
    }
    return next(error);
  }
};

exports.getApplicationsByUserId = async (req, res, next) => {
  try {
    // userId comes from the authenticated token, never from the request
    const { userType, creatorId, tenantId } = extractUserAndCreatorContext(req);
    const userId = creatorId ? String(creatorId) : null;

    if (userType !== "CRM" && userType !== "PORTAL") {
      return next(AppError.forbidden("Access denied."));
    }

    if (!userId || !tenantId) {
      return next(AppError.forbidden("Access denied."));
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return next(AppError.badRequest("Invalid user ID in token"));
    }

    const statusFilters = parseStatusFilters(req.query.type);
    const applications = await applicationService.getApplicationsByCreator(
      userId,
      tenantId,
      statusFilters,
    );

    return res.success({
      userId,
      count: applications.length,
      applications,
    });
  } catch (error) {
    console.error(
      "ApplicationController [getApplicationsByUserId] Error:",
      error?.message || error,
    );
    if (error?.stack) console.error(error.stack);
    return next(error);
  }
};

exports.getMyApplications = async (req, res, next) => {
  try {
    const { userType, userId, tenantId } = extractUserAndCreatorContext(req);
    if (userType !== "PORTAL") {
      return next(
        AppError.forbidden(
          "Access denied. Only portal users can use this endpoint.",
        ),
      );
    }
    if (!userId || !tenantId) {
      return next(AppError.forbidden("Access denied."));
    }

    const portalEmail = extractPortalEmail(req);
    const { profileIds, lookupEmail } = await resolveProfileIdsForPortalUser(
      userId,
      tenantId,
      portalEmail,
    );

    const statusFilters = parseStatusFilters(req.query.type);
    const applications = await applicationService.getApplicationsForPortalUser({
      userId: String(userId),
      tenantId: String(tenantId),
      profileIds,
      email: portalEmail || lookupEmail,
      statusFilters,
    });

    return res.success({
      profileId: profileIds[0] || null,
      count: applications.length,
      applications,
    });
  } catch (error) {
    console.error(
      "ApplicationController [getMyApplications] Error:",
      error?.message || error,
    );
    if (error?.stack) console.error(error.stack);
    return next(error);
  }
};

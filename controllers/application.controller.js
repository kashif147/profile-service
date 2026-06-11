const crypto = require("crypto");
const applicationService = require("../services/application.service");
const applicationFilterTemplateService = require("../services/application.filter.template.service");
const { extractUserAndCreatorContext } = require("../helpers/get.user.info.js");
const joischemas = require("../validation/index.js");
const { AppError } = require("../errors/AppError");
const mongoose = require("mongoose");
const { APPLICATION_STATUS } = require("../constants/enums");
const Profile = require("../models/profile.model");
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
// const { emitApplicationApproved, emitApplicationRejected } = require("../events/applicationEvents");

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

function buildPortalUserIdMatcher(userId) {
  return new mongoose.Types.ObjectId(String(userId));
}

// Original GET API - unchanged
exports.getAllApplications = async (req, res, next) => {
  try {
    const { userType } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM user can view applications.",
        ),
      );
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

    const result = await applicationService.getAllApplicationsWithDetails(
      statusFilters,
      page,
      limit,
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
    const columns =
      Array.isArray(req.body?.columns) && req.body.columns.length > 0
        ? req.body.columns
        : template.columns || [];

    // Get applications with filters using the NEW service method
    const result = await applicationService.getApplicationsWithTemplateFilters(
      filters,
      page,
      limit,
      columns,
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

    const applicationDetails =
      await applicationService.getApplicationWithDetails(applicationId);

    if (!applicationDetails) {
      return res.notFoundRecord("Application not found");
    }

    if (userType === "PORTAL") {
      if (!userId || !tenantId || !mongoose.Types.ObjectId.isValid(String(userId))) {
        return next(
          AppError.forbidden(
            "Access denied. You can only view your own applications.",
          ),
        );
      }

      const personalDetails = applicationDetails.personalDetails || {};
      const personalUserId = personalDetails.userId
        ? String(personalDetails.userId)
        : null;
      const personalTenantId = personalDetails.tenantId
        ? String(personalDetails.tenantId)
        : null;

      let ownsApplication =
        personalUserId === String(userId) &&
        personalTenantId === String(tenantId);

      if (!ownsApplication) {
        const profileId = personalDetails.profileId;
        if (profileId && mongoose.Types.ObjectId.isValid(String(profileId))) {
          const ownsProfile = await Profile.exists({
            _id: new mongoose.Types.ObjectId(String(profileId)),
            tenantId: String(tenantId),
            userId: buildPortalUserIdMatcher(String(userId)),
          });
          ownsApplication = !!ownsProfile;
        }
      }

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

    // Use the application service
    const updatedApplication = await applicationService.updateApplicationStatus(
      applicationId,
      applicationStatus,
      creatorId,
      comments,
    );

    const decision = (applicationStatus || "").toLowerCase().trim();
    if (decision === APPLICATION_STATUS.APPROVED) {
      try {
        const [personal, professional, subscription] = await Promise.all([
          PersonalDetails.findOne({ applicationId }).lean(),
          ProfessionalDetails.findOne({ applicationId }).lean(),
          SubscriptionDetails.findOne({ applicationId }).lean(),
        ]);
        const profileDoc =
          personal?.profileId &&
          mongoose.Types.ObjectId.isValid(String(personal.profileId))
            ? await Profile.findById(personal.profileId).lean()
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
        await ApplicationApprovalEventPublisher.publishApplicationApproved({
          applicationId,
          reviewerId: creatorId,
          profileId: personal?.profileId ? String(personal.profileId) : null,
          applicationStatus: "APPROVED",
          isExistingProfile: !!profileDoc,
          crmUserId: profileDoc?.crmUserId
            ? String(profileDoc.crmUserId)
            : null,
          memberId: profileDoc?.membershipNumber || null,
          userId: profileDoc?.userId ? String(profileDoc.userId) : null,
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
          "[approveApplication] Failed to publish application approved event:",
          publishError.message,
        );
      }
    } else if (decision === APPLICATION_STATUS.REJECTED) {
      try {
        const personal = await PersonalDetails.findOne({ applicationId })
          .select("userId")
          .lean();
        await ApplicationApprovalEventPublisher.publishApplicationRejected({
          applicationId,
          reviewerId: creatorId,
          reason: comments || null,
          notes: null,
          tenantId: tenantId != null ? String(tenantId) : null,
          userId: personal?.userId ? String(personal.userId) : null,
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
      const ownsProfile = await Profile.exists({
        _id: new mongoose.Types.ObjectId(profileId),
        tenantId: String(tenantId),
        userId: buildPortalUserIdMatcher(String(userId)),
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
    const applications = await applicationService.getApplicationsByProfileId(
      profileId,
      statusFilters,
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
    if (!mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.success({
        profileId: null,
        count: 0,
        applications: [],
      });
    }

    const profile = await Profile.findOne({
      tenantId: String(tenantId),
      userId: buildPortalUserIdMatcher(String(userId)),
    })
      .sort({ updatedAt: -1 })
      .select("_id")
      .lean();

    if (!profile?._id) {
      return res.success({
        profileId: null,
        count: 0,
        applications: [],
      });
    }

    const statusFilters = parseStatusFilters(req.query.type);
    const applications = await applicationService.getApplicationsByProfileId(
      profile._id.toString(),
      statusFilters,
    );

    return res.success({
      profileId: profile._id.toString(),
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

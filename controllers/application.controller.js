const applicationService = require("../services/application.service");
const applicationFilterTemplateService = require("../services/application.filter.template.service");
const { extractUserAndCreatorContext } = require("../helpers/get.user.info.js");
const joischemas = require("../validation/index.js");
const { AppError } = require("../errors/AppError");
const mongoose = require("mongoose");
const { APPLICATION_STATUS } = require("../constants/enums");
// const { emitApplicationApproved, emitApplicationRejected } = require("../events/applicationEvents");

// Original GET API - unchanged
exports.getAllApplications = async (req, res, next) => {
  try {
    const { userType } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM user can view applications."
        )
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
    const limit = validatedQuery.limit || 10;

    const result =
      await applicationService.getAllApplicationsWithDetails(
        statusFilters,
        page,
        limit
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
    const { userType, creatorId } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM users can view applications."
        )
      );
    }

    const page = req.body.page ? parseInt(req.body.page) : 1;
    const limit = req.body.limit ? parseInt(req.body.limit) : 10;
    const templateId = req.body.templateId;

    let template;

    // If templateId is provided, fetch and validate the template
    if (templateId) {
      template = await applicationFilterTemplateService.getTemplateById(
        templateId,
        creatorId
      );
      
      if (!template) {
        return next(
          AppError.notFound(
            "Template not found or you don't have permission to access it"
          )
        );
      }
      // This API returns applications; only allow templates of type "application"
      if (template.templateType && template.templateType !== "application") {
        return next(
          AppError.badRequest(
            "This template is not an application template. Use a template with templateType 'application'."
          )
        );
      }
    } else {
      // No templateId: use user's default template for application, else system default
      template = await applicationFilterTemplateService.getDefaultTemplateForType(
        creatorId,
        "application"
      );
      if (!template) {
        template = await applicationFilterTemplateService.getSystemDefaultTemplate("application");
      }
    }

    // Normalize filters: support new shape (applicationStatus: { operator, values }) and legacy (type: value or [values])
    let filters = template.filters || {};
    if (filters.type !== undefined && !filters.applicationStatus) {
      const legacyValues = Array.isArray(filters.type) ? filters.type : [filters.type];
      filters = {
        ...filters,
        applicationStatus: { operator: "equal_to", values: legacyValues },
      };
    }

    // Extract columns from template
    const columns = template.columns || [];

    // Get applications with filters using the NEW service method
    const result =
      await applicationService.getApplicationsWithTemplateFilters(
        filters,
        page,
        limit,
        columns
      );

    return res.success({
      filter: template.filters || "default",
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
    console.error("ApplicationController [getApplicationsWithTemplate] Error:", error);
    if (error.isJoi) {
      return next(AppError.badRequest("Validation error: " + error.message));
    }
    if (error.message && error.message.includes("not found")) {
      return next(
        AppError.notFound(error.message)
      );
    }
    return next(error);
  }
};

exports.getApplicationById = async (req, res, next) => {
  try {
    const { userType } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM users can view applications."
        )
      );
    }
    const { applicationId } = req.params;

    const applicationDetails =
      await applicationService.getApplicationWithDetails(applicationId);
    
    if (!applicationDetails) {
      return res.notFoundRecord("Application not found");
    }
    
    return res.success(applicationDetails);
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
    const { userType, creatorId } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM users can approve applications."
        )
      );
    }

    const { applicationId } = req.params;

    // Validate request body
    const validatedData = await joischemas.application_approve.validateAsync(
      req.body
    );
    const { comments, applicationStatus } = validatedData;

    // Use the application service
    const updatedApplication = await applicationService.updateApplicationStatus(
      applicationId,
      applicationStatus,
      creatorId,
      comments
    );

    // // Get subscription details for the user
    // const subscriptionDetails = await SubscriptionDetails.findOne({
    //   userId: updatedApplication.userId,
    //   "meta.deleted": false,
    // });

    // // Prepare event data
    // const eventData = {
    //   personalDetails: updatedApplication,
    //   subscriptionDetails: subscriptionDetails,
    //   approvalDetails: updatedApplication.approvalDetails,
    // };

    // // Emit appropriate event based on status
    // if (applicationStatus === "approved") {
    //   await emitApplicationApproved(eventData);
    // } else if (applicationStatus === "rejected") {
    //   await emitApplicationRejected(eventData);
    // }

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
    const { userType } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM users can view applications."
        )
      );
    }

    const { profileId } = req.params;

    if (!profileId || !mongoose.Types.ObjectId.isValid(profileId)) {
      return next(AppError.badRequest("Invalid profileId"));
    }

    const rawType = req.query.type;
    const statusFilters = [];
    if (rawType) {
      const values = Array.isArray(rawType) ? rawType : [rawType];
      const validStatuses = Object.values(APPLICATION_STATUS);
      for (const v of values) {
        const normalized = typeof v === "string" ? v.toLowerCase().trim() : v;
        if (normalized && validStatuses.includes(normalized)) {
          statusFilters.push(normalized);
        }
      }
    }

    const applications = await applicationService.getApplicationsByProfileId(profileId, statusFilters);

    return res.success({
      profileId,
      count: applications.length,
      applications,
    });
  } catch (error) {
    console.error("ApplicationController [getApplicationsByProfileId] Error:", error?.message || error);
    if (error?.stack) console.error(error.stack);
    if (error?.message?.includes("Profile ID is required")) {
      return next(AppError.badRequest(error.message));
    }
    return next(error);
  }
};

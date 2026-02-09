const applicationFilterTemplateService = require("../services/application.filter.template.service");
const { extractUserAndCreatorContext } = require("../helpers/get.user.info.js");
const joischemas = require("../validation/index.js");
const { AppError } = require("../errors/AppError");

/**
 * Create a new filter template
 */
exports.createTemplate = async (req, res, next) => {
  try {
    const { userType, creatorId } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM users can create filter templates."
        )
      );
    }

    const validatedData =
      await joischemas.filter_template_create.validateAsync(req.body);

    const template = await applicationFilterTemplateService.createTemplate(
      creatorId,
      validatedData
    );

    return res.success(template, "Filter template created successfully");
  } catch (error) {
    console.error(
      "ApplicationFilterTemplateController [createTemplate] Error:",
      error
    );
    if (error.isJoi) {
      return next(AppError.badRequest("Validation error: " + error.message));
    }
    return next(error);
  }
};

/**
 * Get templates for the current user. Query param: type (e.g. application). Default: application.
 * Response: data with total and templates (systemDefault, userTemplates).
 */
exports.getUserTemplates = async (req, res, next) => {
  try {
    const { userType, creatorId } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM users can view templates."
        )
      );
    }

    const type = req.query.type || "application";
    const list =
      await applicationFilterTemplateService.getUserTemplatesWithSystemDefault(creatorId, type);

    const systemDefault = list.find((t) => t.systemDefault) || null;
    const userTemplates = list.filter((t) => !t.systemDefault);

    return res.success({
      total: list.length,
      templates: {
        systemDefault,
        userTemplates,
      },
    });
  } catch (error) {
    console.error(
      "ApplicationFilterTemplateController [getUserTemplates] Error:",
      error
    );
    return next(error);
  }
};

/**
 * Get a specific template by ID
 */
exports.getTemplateById = async (req, res, next) => {
  try {
    const { userType, creatorId } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM users can view filter templates."
        )
      );
    }

    const { templateId } = req.params;

    const template =
      await applicationFilterTemplateService.getTemplateById(
        templateId,
        creatorId
      );

    return res.success(template);
  } catch (error) {
    console.error(
      "ApplicationFilterTemplateController [getTemplateById] Error:",
      error
    );
    if (error.message.includes("not found")) {
      return res.notFoundRecord("Filter template not found");
    }
    return next(error);
  }
};

/**
 * Update a filter template
 */
exports.updateTemplate = async (req, res, next) => {
  try {
    const { userType, creatorId } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM users can update filter templates."
        )
      );
    }

    const { templateId } = req.params;
    const validatedData =
      await joischemas.filter_template_update.validateAsync(req.body);

    const template = await applicationFilterTemplateService.updateTemplate(
      templateId,
      creatorId,
      validatedData
    );

    return res.success(template, "Filter template updated successfully");
  } catch (error) {
    console.error(
      "ApplicationFilterTemplateController [updateTemplate] Error:",
      error
    );
    if (error.isJoi) {
      return next(AppError.badRequest("Validation error: " + error.message));
    }
    if (error.message.includes("not found")) {
      return res.notFoundRecord("Filter template not found");
    }
    return next(error);
  }
};

/**
 * Delete a filter template
 */
exports.deleteTemplate = async (req, res, next) => {
  try {
    const { userType, creatorId } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM users can delete filter templates."
        )
      );
    }

    const { templateId } = req.params;

    await applicationFilterTemplateService.deleteTemplate(
      templateId,
      creatorId
    );

    return res.success(null, "Filter template deleted successfully");
  } catch (error) {
    console.error(
      "ApplicationFilterTemplateController [deleteTemplate] Error:",
      error
    );
    if (error.message.includes("not found")) {
      return res.notFoundRecord("Filter template not found");
    }
    return next(error);
  }
};

/**
 * Get default template for the current user
 */
exports.getDefaultTemplate = async (req, res, next) => {
  try {
    const { userType, creatorId } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM users can view filter templates."
        )
      );
    }

    const template =
      await applicationFilterTemplateService.getDefaultTemplate(creatorId);

    return res.success(template);
  } catch (error) {
    console.error(
      "ApplicationFilterTemplateController [getDefaultTemplate] Error:",
      error
    );
    return next(error);
  }
};


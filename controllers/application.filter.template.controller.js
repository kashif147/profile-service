const applicationFilterTemplateService = require("../services/application.filter.template.service");
const { extractUserAndCreatorContext } = require("../helpers/get.user.info.js");
const joischemas = require("../validation/index.js");
const { AppError } = require("../errors/AppError");

function normalizeRoleValue(role) {
  if (!role) return "";
  const raw =
    typeof role === "string"
      ? role
      : role.code || role.name || role.roleCode || role.roleName || "";
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function canEditSystemDefaultTemplate(req) {
  const roles = Array.isArray(req.roles)
    ? req.roles
    : Array.isArray(req.user?.roles)
      ? req.user.roles
      : [];
  const normalizedRoles = roles.map(normalizeRoleValue).filter(Boolean);
  return normalizedRoles.some((role) =>
    [
      "su",
      "asu",
      "super user",
      "assistant super user",
      "system admin",
      "system administrator",
      "superuser",
      "assistantsuperuser",
      "systemadmin",
    ].includes(role)
  );
}

function isSystemDefaultPreferenceOnlyUpdate(payload = {}) {
  const keys = Object.keys(payload || {}).filter(
    (key) => payload[key] !== undefined,
  );
  if (keys.length === 0) return false;
  return keys.every((key) => key === "isDefault" || key === "pinned");
}

/**
 * Create a new filter template
 */
exports.createTemplate = async (req, res, next) => {
  try {
    const { userType, creatorId, tenantId } = extractUserAndCreatorContext(req);
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
      validatedData,
      tenantId || null
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
    const { userType, creatorId, tenantId } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM users can view templates."
        )
      );
    }

    const type = req.query.type || "application";
    const list =
      await applicationFilterTemplateService.getUserTemplatesWithSystemDefault(
        creatorId,
        type,
        tenantId || null
      );

    const systemDefault = list.find((t) => t.systemDefault) || null;
    const userTemplates = list.filter((t) => !t.systemDefault);
    const userHasDefault = userTemplates.some((t) => t.isDefault);
    if (systemDefault && !userHasDefault) {
      systemDefault.isDefault = true;
    }

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
    const { userType, creatorId, tenantId } = extractUserAndCreatorContext(req);
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
        creatorId,
        tenantId || null
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
    const { userType, creatorId, tenantId } = extractUserAndCreatorContext(req);
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

    const existingTemplate = await applicationFilterTemplateService.getTemplateById(
      templateId,
      creatorId,
      tenantId || null
    );
    const isPreferenceOnly =
      existingTemplate?.systemDefault &&
      isSystemDefaultPreferenceOnlyUpdate(validatedData);
    if (
      existingTemplate?.systemDefault &&
      !isPreferenceOnly &&
      !canEditSystemDefaultTemplate(req)
    ) {
      return next(
        AppError.forbidden(
          "Access denied. Only System Administrator with Assistant Super User or Super User role can update system default templates."
        )
      );
    }

    const template = await applicationFilterTemplateService.updateTemplate(
      templateId,
      creatorId,
      validatedData,
      tenantId || null
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
    const { userType, creatorId, tenantId } = extractUserAndCreatorContext(req);
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
      creatorId,
      tenantId || null
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
    const { userType, creatorId, tenantId } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM users can view filter templates."
        )
      );
    }

    const template =
      await applicationFilterTemplateService.getDefaultTemplate(
        creatorId,
        tenantId || null
      );

    return res.success(template);
  } catch (error) {
    console.error(
      "ApplicationFilterTemplateController [getDefaultTemplate] Error:",
      error
    );
    return next(error);
  }
};


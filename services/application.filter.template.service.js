const Template = require("../models/template.model");
const { AppError } = require("../errors/AppError");
const { APPLICATION_STATUS } = require("../constants/enums");

/**
 * Application Filter Template Service Layer
 * Contains business logic for filter template operations
 */
class TemplateService {
  /**
   * Create a new filter template
   * @param {string} userId - User ID who created the template
   * @param {Object} templateData - Template data (filters, isDefault)
   * @returns {Promise<Object>} Created template
   */
  async createTemplate(userId, templateData) {
    try {
      const { templateType, filters, columns, isDefault, pinned } = templateData;
      const type = templateType || "application";

      if (isDefault) {
        const existingDefault = await Template.findOne({
          userId,
          templateType: type,
          isDefault: true,
          "meta.deleted": false,
        });
        if (existingDefault) {
          throw AppError.badRequest(
            "You already have a default template for this type. Please unset the existing default template first, then set this one as default."
          );
        }
      }

      const template = new Template({
        userId,
        templateType: type,
        filters: filters || {},
        columns: columns || [],
        isDefault: isDefault || false,
        pinned: pinned || false,
      });

      return await template.save();
    } catch (error) {
      console.error(
        "TemplateService [createTemplate] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Get all filter templates for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Array of templates
   */
  async getUserTemplates(userId) {
    try {
      return await Template.find({
        userId,
        "meta.deleted": false,
      }).sort({ isDefault: -1, createdAt: -1 });
    } catch (error) {
      console.error(
        "TemplateService [getUserTemplates] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Get user templates + system default template, filtered by type (e.g. application).
   * @param {string} userId - User ID
   * @param {string} type - Template type (e.g. "application"). Default "application".
   * @returns {Promise<Array>} Array of templates (system default first, then user templates)
   */
  async getUserTemplatesWithSystemDefault(userId, type = "application") {
    try {
      const typeFilter = { templateType: type };

      const systemDefault = await Template.findOne({
        systemDefault: true,
        "meta.deleted": false,
        ...typeFilter,
      });

      const userTemplates = await Template.find({
        userId,
        "meta.deleted": false,
        ...typeFilter,
      }).sort({ pinned: -1, isDefault: -1, createdAt: -1 });

      // Combine: system default first, then user templates
      const allTemplates = [];
      
      if (systemDefault) {
        allTemplates.push(systemDefault);
      }
      
      allTemplates.push(...userTemplates);

      return allTemplates;
    } catch (error) {
      console.error(
        "TemplateService [getUserTemplatesWithSystemDefault] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Get a specific template by ID
   * Returns template if: (1) it's the system default, or (2) it belongs to the user
   * @param {string} templateId - Template ID
   * @param {string} userId - User ID (for authorization)
   * @returns {Promise<Object>} Template
   */
  async getTemplateById(templateId, userId) {
    try {
      // Allow system default by ID so frontend can pass it like any other template
      const systemDefault = await Template.findOne({
        _id: templateId,
        systemDefault: true,
        "meta.deleted": false,
      });
      if (systemDefault) return systemDefault;

      const template = await Template.findOne({
        _id: templateId,
        userId,
        "meta.deleted": false,
      });

      if (!template) {
        throw AppError.notFound("Filter template not found");
      }

      return template;
    } catch (error) {
      console.error(
        "TemplateService [getTemplateById] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Update a filter template
   * @param {string} templateId - Template ID
   * @param {string} userId - User ID (for authorization)
   * @param {Object} updateData - Update data
   * @returns {Promise<Object>} Updated template
   */
  async updateTemplate(templateId, userId, updateData) {
    try {
      const { templateType, filters, columns, isDefault, pinned } = updateData;

      const template = await Template.findOne({
        _id: templateId,
        userId,
        "meta.deleted": false,
      });

      if (!template) {
        throw AppError.notFound("Filter template not found");
      }

      const type = templateType !== undefined ? templateType : template.templateType;

      // When setting isDefault: true, ensure user does not already have another default for this type
      if (isDefault === true) {
        const existingDefault = await Template.findOne({
          userId,
          templateType: type,
          _id: { $ne: templateId },
          isDefault: true,
          "meta.deleted": false,
        });
        if (existingDefault) {
          throw AppError.badRequest(
            "You already have a default template for this type. Please unset the existing default template first, then set this one as default."
          );
        }
      }

      // Update fields
      if (templateType !== undefined) {
        template.templateType = templateType;
      }
      if (filters !== undefined) {
        template.filters = filters;
      }
      if (columns !== undefined) {
        template.columns = columns;
      }
      if (isDefault !== undefined) {
        template.isDefault = isDefault;
      }
      if (pinned !== undefined) {
        template.pinned = pinned;
      }

      return await template.save();
    } catch (error) {
      console.error(
        "TemplateService [updateTemplate] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Delete a filter template (soft delete)
   * @param {string} templateId - Template ID
   * @param {string} userId - User ID (for authorization)
   * @returns {Promise<Object>} Deleted template
   */
  async deleteTemplate(templateId, userId) {
    try {
      const template = await Template.findOne({
        _id: templateId,
        userId,
        "meta.deleted": false,
      });

      if (!template) {
        throw AppError.notFound("Filter template not found");
      }

      template.meta.deleted = true;
      template.meta.deletedAt = new Date();

      return await template.save();
    } catch (error) {
      console.error(
        "TemplateService [deleteTemplate] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Get default template for a user (any type). Used by GET /templates/default.
   * If no default exists, creates one for submitted applications (application type).
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Default template (always returns a template)
   */
  async getDefaultTemplate(userId) {
    try {
      let template = await Template.findOne({
        userId,
        isDefault: true,
        "meta.deleted": false,
      });

      // If no default template exists, create one for submitted applications
      if (!template) {
        template = new Template({
          userId,
          templateType: "application",
          filters: {
            type: APPLICATION_STATUS.SUBMITTED,
          },
          columns: [],
          isDefault: true,
          pinned: false,
        });

        template = await template.save();
      }

      return template;
    } catch (error) {
      console.error(
        "TemplateService [getDefaultTemplate] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Get user's default template for a given type (e.g. application). Returns null if none.
   * @param {string} userId - User ID
   * @param {string} type - Template type (e.g. "application")
   * @returns {Promise<Object|null>} User default template or null
   */
  async getDefaultTemplateForType(userId, type = "application") {
    try {
      return await Template.findOne({
        userId,
        templateType: type,
        isDefault: true,
        "meta.deleted": false,
      });
    } catch (error) {
      console.error(
        "TemplateService [getDefaultTemplateForType] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Get system-wide default template. Optional type filter (e.g. "application").
   * @param {string} [type] - Template type (e.g. "application")
   * @returns {Promise<Object>} System default template
   */
  async getSystemDefaultTemplate(type = "application") {
    try {
      const query = {
        systemDefault: true,
        "meta.deleted": false,
      };
      if (type) {
        query.templateType = type;
      }
      const template = await Template.findOne(query);

      if (!template) {
        throw AppError.notFound(
          "System default template not found. Please create one in the database with systemDefault: true"
        );
      }

      return template;
    } catch (error) {
      console.error(
        "TemplateService [getSystemDefaultTemplate] Error:",
        error
      );
      throw error;
    }
  }
}

module.exports = new TemplateService();


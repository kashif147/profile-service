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
      const { templateType, filters, columns, isDefault } = templateData;

      // If setting as default, unset other defaults for this user
      if (isDefault) {
        await Template.updateMany(
          { userId, "meta.deleted": false },
          { $set: { isDefault: false } }
        );
      }

      const template = new Template({
        userId,
        templateType: templateType || "application",
        filters: filters || {},
        columns: columns || [],
        isDefault: isDefault || false,
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
   * NEW METHOD - Get user templates + system default template
   * Returns system default template + all user's personal templates
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Array of templates (system default first, then user templates)
   */
  async getUserTemplatesWithSystemDefault(userId) {
    try {
      // Get system default template
      const systemDefault = await Template.findOne({
        systemDefault: true,
        "meta.deleted": false,
      });

      // Get user's personal templates
      const userTemplates = await Template.find({
        userId,
        "meta.deleted": false,
      }).sort({ isDefault: -1, createdAt: -1 });

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
      const { templateType, filters, columns, isDefault } = updateData;

      const template = await Template.findOne({
        _id: templateId,
        userId,
        "meta.deleted": false,
      });

      if (!template) {
        throw AppError.notFound("Filter template not found");
      }

      // If setting as default, unset other defaults for this user
      if (isDefault === true) {
        await Template.updateMany(
          { userId, _id: { $ne: templateId }, "meta.deleted": false },
          { $set: { isDefault: false } }
        );
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
   * Get default template for a user
   * If no default template exists, creates one for submitted applications
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
   * NEW METHOD - Get system-wide default template
   * This template should exist in the database with systemDefault: true
   * Used when no templateId is provided in the PUT API request
   * @returns {Promise<Object>} System default template
   */
  async getSystemDefaultTemplate() {
    try {
      const template = await Template.findOne({
        systemDefault: true,
        "meta.deleted": false,
      });

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


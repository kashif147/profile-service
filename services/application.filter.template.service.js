const ApplicationFilterTemplate = require("../models/application.filter.template.model");
const { AppError } = require("../errors/AppError");
const { APPLICATION_STATUS } = require("../constants/enums");

/**
 * Application Filter Template Service Layer
 * Contains business logic for filter template operations
 */
class ApplicationFilterTemplateService {
  /**
   * Create a new filter template
   * @param {string} userId - User ID who created the template
   * @param {Object} templateData - Template data (filters, isDefault)
   * @returns {Promise<Object>} Created template
   */
  async createTemplate(userId, templateData) {
    try {
      const { filters, columns, isDefault } = templateData;

      // If setting as default, unset other defaults for this user
      if (isDefault) {
        await ApplicationFilterTemplate.updateMany(
          { userId, "meta.deleted": false },
          { $set: { isDefault: false } }
        );
      }

      const template = new ApplicationFilterTemplate({
        userId,
        filters: filters || {},
        columns: columns || [],
        isDefault: isDefault || false,
      });

      return await template.save();
    } catch (error) {
      console.error(
        "ApplicationFilterTemplateService [createTemplate] Error:",
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
      return await ApplicationFilterTemplate.find({
        userId,
        "meta.deleted": false,
      }).sort({ isDefault: -1, createdAt: -1 });
    } catch (error) {
      console.error(
        "ApplicationFilterTemplateService [getUserTemplates] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Get a specific template by ID
   * @param {string} templateId - Template ID
   * @param {string} userId - User ID (for authorization)
   * @returns {Promise<Object>} Template
   */
  async getTemplateById(templateId, userId) {
    try {
      const template = await ApplicationFilterTemplate.findOne({
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
        "ApplicationFilterTemplateService [getTemplateById] Error:",
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
      const { filters, columns, isDefault } = updateData;

      const template = await ApplicationFilterTemplate.findOne({
        _id: templateId,
        userId,
        "meta.deleted": false,
      });

      if (!template) {
        throw AppError.notFound("Filter template not found");
      }

      // If setting as default, unset other defaults for this user
      if (isDefault === true) {
        await ApplicationFilterTemplate.updateMany(
          { userId, _id: { $ne: templateId }, "meta.deleted": false },
          { $set: { isDefault: false } }
        );
      }

      // Update fields
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
        "ApplicationFilterTemplateService [updateTemplate] Error:",
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
      const template = await ApplicationFilterTemplate.findOne({
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
        "ApplicationFilterTemplateService [deleteTemplate] Error:",
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
      let template = await ApplicationFilterTemplate.findOne({
        userId,
        isDefault: true,
        "meta.deleted": false,
      });

      // If no default template exists, create one for submitted applications
      if (!template) {
        template = new ApplicationFilterTemplate({
          userId,
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
        "ApplicationFilterTemplateService [getDefaultTemplate] Error:",
        error
      );
      throw error;
    }
  }
}

module.exports = new ApplicationFilterTemplateService();


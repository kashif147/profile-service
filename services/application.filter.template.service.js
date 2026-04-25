const Template = require("../models/template.model");
const { AppError } = require("../errors/AppError");
const { APPLICATION_STATUS } = require("../constants/enums");

/** Return template for API response (no meta, no __v) */
function toTemplateResponse(doc) {
  const obj =
    doc && typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  delete obj.meta;
  delete obj.__v;
  return obj;
}

function tenantOrLegacyMatch(tenantId) {
  if (!tenantId) return {};
  return {
    $or: [
      { tenantId },
      { tenantId: null },
      { tenantId: { $exists: false } },
    ],
  };
}

async function findSystemDefaultTemplateDoc(type, tenantId) {
  const base = {
    systemDefault: true,
    "meta.deleted": false,
    templateType: type,
  };
  if (tenantId) {
    const scoped = await Template.findOne({ ...base, tenantId });
    if (scoped) return scoped;
  }
  return Template.findOne({
    ...base,
    $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
  });
}

/**
 * Application Filter Template Service Layer
 */
class TemplateService {
  async createTemplate(userId, templateData, tenantId = null) {
    try {
      const {
        name,
        templateType,
        filters,
        columns,
        columnLabels,
        isDefault,
        pinned,
      } =
        templateData;
      const type = templateType || "application";

      const scope = { userId, templateType: type, isDefault: true, "meta.deleted": false };
      Object.assign(scope, tenantOrLegacyMatch(tenantId));

      if (isDefault) {
        await Template.updateMany(scope, { $set: { isDefault: false } });
      }

      const template = new Template({
        userId,
        tenantId: tenantId || undefined,
        name: name != null && name !== "" ? name : undefined,
        templateType: type,
        filters: filters || {},
        columns: columns || [],
        columnLabels: columnLabels || {},
        isDefault: isDefault || false,
        pinned: pinned || false,
      });

      const saved = await template.save();
      return toTemplateResponse(saved);
    } catch (error) {
      console.error("TemplateService [createTemplate] Error:", error);
      throw error;
    }
  }

  async getUserTemplates(userId, tenantId = null) {
    try {
      const q = { userId, "meta.deleted": false };
      Object.assign(q, tenantOrLegacyMatch(tenantId));
      return await Template.find(q).sort({ isDefault: -1, createdAt: -1 });
    } catch (error) {
      console.error("TemplateService [getUserTemplates] Error:", error);
      throw error;
    }
  }

  async getUserTemplatesWithSystemDefault(userId, type = "application", tenantId = null) {
    try {
      const typeFilter = { templateType: type };

      const systemDefault = await findSystemDefaultTemplateDoc(type, tenantId);

      const uq = {
        userId,
        "meta.deleted": false,
        ...typeFilter,
      };
      Object.assign(uq, tenantOrLegacyMatch(tenantId));

      const userTemplates = await Template.find(uq).sort({
        pinned: -1,
        isDefault: -1,
        createdAt: -1,
      });

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

  async getTemplateById(templateId, userId, tenantId = null) {
    try {
      const systemDefault = await Template.findOne({
        _id: templateId,
        systemDefault: true,
        "meta.deleted": false,
      });
      if (systemDefault) {
        if (tenantId && systemDefault.tenantId && String(systemDefault.tenantId) !== String(tenantId)) {
          throw AppError.notFound("Filter template not found");
        }
        const type = systemDefault.templateType || "application";
        const dq = {
          userId,
          templateType: type,
          isDefault: true,
          "meta.deleted": false,
        };
        Object.assign(dq, tenantOrLegacyMatch(tenantId));
        const userHasDefault = await Template.exists(dq);
        const out = toTemplateResponse(systemDefault);
        if (!userHasDefault) out.isDefault = true;
        return out;
      }

      const tq = { _id: templateId, userId, "meta.deleted": false };
      Object.assign(tq, tenantOrLegacyMatch(tenantId));

      const template = await Template.findOne(tq);

      if (!template) {
        throw AppError.notFound("Filter template not found");
      }

      return template;
    } catch (error) {
      console.error("TemplateService [getTemplateById] Error:", error);
      throw error;
    }
  }

  async updateTemplate(
    templateId,
    userId,
    updateData,
    tenantId = null,
    allowSystemDefaultEdits = false,
  ) {
    try {
      const {
        name,
        templateType,
        filters,
        columns,
        columnLabels,
        isDefault,
        pinned,
      } =
        updateData;

      let template = await Template.findOne({
        _id: templateId,
        systemDefault: true,
        "meta.deleted": false,
      });

      if (template && tenantId && template.tenantId && String(template.tenantId) !== String(tenantId)) {
        template = null;
      }

      if (!template) {
        const tq = { _id: templateId, userId, "meta.deleted": false };
        Object.assign(tq, tenantOrLegacyMatch(tenantId));
        template = await Template.findOne(tq);
      }

      if (!template) {
        throw AppError.notFound("Filter template not found");
      }

      const type =
        templateType !== undefined ? templateType : template.templateType;

      if (template.systemDefault && !allowSystemDefaultEdits) {
        if (isDefault === true) {
          const mq = {
            userId,
            templateType: type,
            "meta.deleted": false,
          };
          Object.assign(mq, tenantOrLegacyMatch(tenantId));
          await Template.updateMany(mq, { $set: { isDefault: false } });
        }
        if (pinned !== undefined) template.pinned = pinned;
        const saved = await template.save();
        const response = toTemplateResponse(saved);
        if (isDefault === true) response.isDefault = true;
        return response;
      }

      if (isDefault === true) {
        const mq = {
          userId,
          templateType: type,
          _id: { $ne: templateId },
          "meta.deleted": false,
        };
        Object.assign(mq, tenantOrLegacyMatch(tenantId));
        await Template.updateMany(mq, { $set: { isDefault: false } });
      }

      if (name !== undefined) {
        template.name = name !== "" ? name : null;
      }
      if (templateType !== undefined) {
        template.templateType = templateType;
      }
      if (filters !== undefined) {
        template.filters = filters;
      }
      if (columns !== undefined) {
        template.columns = columns;
      }
      if (columnLabels !== undefined) {
        template.columnLabels = columnLabels;
      }
      if (isDefault !== undefined) {
        template.isDefault = isDefault;
      }
      if (pinned !== undefined) {
        template.pinned = pinned;
      }

      const saved = await template.save();
      return toTemplateResponse(saved);
    } catch (error) {
      console.error("TemplateService [updateTemplate] Error:", error);
      throw error;
    }
  }

  async deleteTemplate(templateId, userId, tenantId = null) {
    try {
      const tq = { _id: templateId, userId, "meta.deleted": false };
      Object.assign(tq, tenantOrLegacyMatch(tenantId));

      const template = await Template.findOne(tq);

      if (!template) {
        throw AppError.notFound("Filter template not found");
      }

      template.meta.deleted = true;
      template.meta.deletedAt = new Date();

      return await template.save();
    } catch (error) {
      console.error("TemplateService [deleteTemplate] Error:", error);
      throw error;
    }
  }

  async getDefaultTemplate(userId, tenantId = null) {
    try {
      const dq = { userId, isDefault: true, "meta.deleted": false };
      Object.assign(dq, tenantOrLegacyMatch(tenantId));

      let template = await Template.findOne(dq);

      if (!template) {
        template = new Template({
          userId,
          tenantId: tenantId || undefined,
          templateType: "application",
          filters: {
            applicationStatus: {
              operator: "equal_to",
              values: [APPLICATION_STATUS.SUBMITTED],
            },
          },
          columns: [],
          isDefault: true,
          pinned: false,
        });

        template = await template.save();
      }

      return template;
    } catch (error) {
      console.error("TemplateService [getDefaultTemplate] Error:", error);
      throw error;
    }
  }

  async getDefaultTemplateForType(userId, type = "application", tenantId = null) {
    try {
      const q = {
        userId,
        templateType: type,
        isDefault: true,
        "meta.deleted": false,
      };
      Object.assign(q, tenantOrLegacyMatch(tenantId));
      return await Template.findOne(q);
    } catch (error) {
      console.error(
        "TemplateService [getDefaultTemplateForType] Error:",
        error
      );
      throw error;
    }
  }

  async getSystemDefaultTemplate(type = "application", tenantId = null) {
    try {
      const template = await findSystemDefaultTemplateDoc(type, tenantId);

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

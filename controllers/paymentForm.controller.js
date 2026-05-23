const paymentFormService = require("../services/paymentForm.service.js");
const { AppError } = require("../errors/AppError.js");
const { extractUserAndCreatorContext } = require("../helpers/get.user.info.js");

exports.prefillPaymentForm = async (req, res, next) => {
  try {
    const { profileId, formType } = req.query;
    if (!profileId || !formType) {
      return next(AppError.badRequest("profileId and formType are required"));
    }
    const { tenantId } = extractUserAndCreatorContext(req);
    if (!tenantId) return next(AppError.badRequest("tenantId is required"));
    const data = await paymentFormService.prefillForm({
      tenantId,
      profileId,
      formType,
      req,
    });
    return res.success({ paymentForm: data });
  } catch (e) {
    return next(e);
  }
};

exports.createPaymentForm = async (req, res, next) => {
  try {
    const { profileId, formType, ...payload } = req.body;
    if (!profileId || !formType) {
      return next(AppError.badRequest("profileId and formType are required"));
    }
    const { tenantId } = extractUserAndCreatorContext(req);
    if (!tenantId) return next(AppError.badRequest("tenantId is required"));
    const data = await paymentFormService.createForm({
      tenantId,
      profileId,
      formType,
      req,
      source: "crm",
      payload,
    });
    return res.success({ paymentForm: data });
  } catch (e) {
    return next(e);
  }
};

exports.filterPaymentForms = async (req, res, next) => {
  try {
    const { tenantId } = extractUserAndCreatorContext(req);
    if (!tenantId) return next(AppError.badRequest("tenantId is required"));
    const page = Number(req.body.page) || 1;
    const limit = Math.min(Number(req.body.limit) || 500, 500);
    const filters = req.body.filters || {};
    if (req.body.formType) filters.formType = req.body.formType;
    if (req.body.status) filters.status = req.body.status;
    const result = await paymentFormService.listWithFilter({
      tenantId,
      filters,
      page,
      limit,
    });
    return res.success(result);
  } catch (e) {
    return next(e);
  }
};

exports.getPaymentFormById = async (req, res, next) => {
  try {
    const { tenantId } = extractUserAndCreatorContext(req);
    const data = await paymentFormService.getById(req.params.id, tenantId, {
      includeSensitive: true,
    });
    return res.success({ paymentForm: data });
  } catch (e) {
    return next(e);
  }
};

exports.updatePaymentForm = async (req, res, next) => {
  try {
    const { tenantId } = extractUserAndCreatorContext(req);
    const data = await paymentFormService.updateForm(
      req.params.id,
      tenantId,
      req.body,
      req
    );
    return res.success({ paymentForm: data });
  } catch (e) {
    return next(e);
  }
};

exports.submitPaymentForm = async (req, res, next) => {
  try {
    const { tenantId } = extractUserAndCreatorContext(req);
    const data = await paymentFormService.submitForm(req.params.id, tenantId, req);
    return res.success({ paymentForm: data });
  } catch (e) {
    return next(e);
  }
};

exports.verifyPaymentForm = async (req, res, next) => {
  try {
    const { tenantId } = extractUserAndCreatorContext(req);
    const data = await paymentFormService.verifyForm(req.params.id, tenantId, req);
    return res.success({ paymentForm: data });
  } catch (e) {
    return next(e);
  }
};

exports.approvePaymentForm = async (req, res, next) => {
  try {
    const { tenantId } = extractUserAndCreatorContext(req);
    const data = await paymentFormService.approveForm(req.params.id, tenantId, req);
    return res.success({ paymentForm: data });
  } catch (e) {
    return next(e);
  }
};

exports.rejectPaymentForm = async (req, res, next) => {
  try {
    const { tenantId } = extractUserAndCreatorContext(req);
    const data = await paymentFormService.rejectForm(
      req.params.id,
      tenantId,
      req,
      req.body.reason
    );
    return res.success({ paymentForm: data });
  } catch (e) {
    return next(e);
  }
};

exports.listProfilePaymentForms = async (req, res, next) => {
  try {
    const { tenantId } = extractUserAndCreatorContext(req);
    const items = await paymentFormService.listForProfile(
      req.params.profileId,
      tenantId
    );
    return res.success({ paymentForms: items });
  } catch (e) {
    return next(e);
  }
};

exports.uploadPaper = async (req, res, next) => {
  try {
    const { tenantId } = extractUserAndCreatorContext(req);
    const data = await paymentFormService.uploadPaper(
      req.params.id,
      tenantId,
      req.file,
      req
    );
    return res.success({ paymentForm: data });
  } catch (e) {
    return next(e);
  }
};

exports.uploadSignedPdf = async (req, res, next) => {
  try {
    const { tenantId } = extractUserAndCreatorContext(req);
    const data = await paymentFormService.uploadSignedPdf(
      req.params.id,
      tenantId,
      req.file,
      req
    );
    return res.success({ paymentForm: data });
  } catch (e) {
    return next(e);
  }
};

exports.sendEmail = async (req, res, next) => {
  try {
    const { tenantId } = extractUserAndCreatorContext(req);
    const data = await paymentFormService.sendFormEmail(
      req.params.id,
      tenantId,
      req.body,
      req
    );
    return res.success({ paymentForm: data });
  } catch (e) {
    return next(e);
  }
};

// Portal
exports.portalListMine = async (req, res, next) => {
  try {
    const { tenantId, userId } = extractUserAndCreatorContext(req);
    if (!userId) return next(AppError.forbidden("Portal user required"));
    const items = await paymentFormService.listPortalForUser(tenantId, userId, req);
    return res.success({ paymentForms: items });
  } catch (e) {
    return next(e);
  }
};

exports.portalGetById = async (req, res, next) => {
  try {
    const { tenantId, userId } = extractUserAndCreatorContext(req);
    const data = await paymentFormService.getById(req.params.id, tenantId, {
      includeSensitive: false,
      portalUserId: userId,
    });
    return res.success({ paymentForm: data });
  } catch (e) {
    return next(e);
  }
};

exports.portalUpdate = async (req, res, next) => {
  try {
    const { tenantId } = extractUserAndCreatorContext(req);
    const data = await paymentFormService.updateForm(
      req.params.id,
      tenantId,
      req.body,
      req,
      { portal: true }
    );
    return res.success({ paymentForm: data });
  } catch (e) {
    return next(e);
  }
};

exports.portalSubmit = async (req, res, next) => {
  try {
    const { tenantId } = extractUserAndCreatorContext(req);
    const data = await paymentFormService.submitForm(req.params.id, tenantId, req, {
      portal: true,
    });
    return res.success({ paymentForm: data });
  } catch (e) {
    return next(e);
  }
};

exports.portalCreate = async (req, res, next) => {
  try {
    const { tenantId, userId } = extractUserAndCreatorContext(req);
    const { formType, ...payload } = req.body;
    if (!formType) return next(AppError.badRequest("formType is required"));
    const Profile = require("../models/profile.model.js");
    const profile = await Profile.findOne({ tenantId, userId }).lean();
    if (!profile) return next(AppError.notFound("Member profile not found"));
    const data = await paymentFormService.createForm({
      tenantId,
      profileId: profile._id,
      formType,
      req,
      source: "portal",
      payload,
    });
    return res.success({ paymentForm: data });
  } catch (e) {
    return next(e);
  }
};

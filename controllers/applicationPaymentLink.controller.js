"use strict";
const Joi = require("joi");
const { AppError } = require("../errors/AppError");
const { requireTenantId } = require("../helpers/requireTenantId");
const service = require("../services/applicationPaymentLink.service.js");

// Tenant and user come from the trusted request context only. The body carries no tenant,
// amount, price or payment state: unknown keys (e.g. "amount") are rejected.
const bodySchema = Joi.object({
  action: Joi.string().valid("ISSUE", "RESEND", "REPLACE").required(),
  // Optional: the server derives it from the application's payment type (card -> FULL,
  // otherwise FIRST_INSTALMENT = three months); a disagreeing value is refused with 409.
  paymentOption: Joi.string().valid("FULL", "FIRST_INSTALMENT").optional(),
});
const paramsSchema = Joi.object({ applicationId: Joi.string().trim().min(1).max(100).required() });
const CHANNELS = new Set(["CRM", "MEMBERSHUB"]);

function staffContext(req) {
  const tenantId = String(requireTenantId(req.tenantId || req.ctx?.tenantId));
  const userId = req.ctx?.userId || req.userId || req.user?.id;
  if (!userId) throw AppError.unauthorized("User context required");
  const userType = req.user?.userType || req.ctx?.userType;
  if (userType !== "CRM") throw AppError.forbidden("Payment links are available to staff users only");
  const requested = String(req.headers["x-client-channel"] || "").toUpperCase();
  return { tenantId, userId: String(userId), channel: CHANNELS.has(requested) ? requested : "CRM" };
}

function validate(schema, value) {
  const { error, value: clean } = schema.validate(value || {}, { abortEarly: false });
  if (error) throw AppError.badRequest("Validation error: " + error.message);
  return clean;
}

exports.requestPaymentLink = async (req, res, next) => {
  try {
    const ctx = staffContext(req);
    const { applicationId } = validate(paramsSchema, req.params);
    const body = validate(bodySchema, req.body);
    const key = String(req.headers["idempotency-key"] || "").trim();
    if (!key || key.length > 100) {
      throw AppError.badRequest("Idempotency-Key header is required (max 100 characters)");
    }
    const result = await service.requestPaymentLink(ctx, applicationId, body, key, req);
    return res.status(result.status).json(result.body);
  } catch (error) {
    return next(error);
  }
};

exports.getApplicationPayment = async (req, res, next) => {
  try {
    const { tenantId } = staffContext(req);
    const { applicationId } = validate(paramsSchema, req.params);
    const view = await service.getApplicationPayment(tenantId, applicationId);
    return res.success(view);
  } catch (error) {
    return next(error);
  }
};

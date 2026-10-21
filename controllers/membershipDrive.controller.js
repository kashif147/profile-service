const Joi = require("joi");
const membershipDriveService = require("../services/membershipDrive.service");
const { AppError } = require("../errors/AppError");
const { requireTenantId } = require("../helpers/requireTenantId");
const { DRIVE_STATUSES } = require("../constants/membershipDrive.constants");

/*
 * Tenant and acting user come only from the trusted request context set by
 * middlewares/auth.js (gateway headers or verified JWT). Bodies are validated with
 * Joi's default unknown-key rejection, so a client-sent tenantId / ownerUserId / status /
 * membershipDrive is a 400, never silently honoured; query/params ids are never used as
 * an identity.
 */

const workLocations = Joi.alternatives()
  .try(Joi.array().items(Joi.string().trim().min(1)).min(1), Joi.string().trim().min(1))
  .custom((v) => (Array.isArray(v) ? [...new Set(v)] : [v]));

const createSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200).required(),
  driveType: Joi.string().trim().min(1).max(100).required(),
  workLocations: workLocations.required(),
  startDate: Joi.date().iso().required(),
  endDate: Joi.date().iso().min(Joi.ref("startDate")).required(),
  signUpTarget: Joi.number().integer().min(0).default(0),
  notes: Joi.string().trim().max(2000).allow("", null).default(null),
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200),
  driveType: Joi.string().trim().min(1).max(100),
  workLocations,
  startDate: Joi.date().iso(),
  endDate: Joi.date().iso(),
  signUpTarget: Joi.number().integer().min(0),
  notes: Joi.string().trim().max(2000).allow("", null),
}).min(1);

const statusSchema = Joi.object({
  status: Joi.string()
    .valid(...DRIVE_STATUSES)
    .required(),
});

const registrationSchema = Joi.object({
  applicationId: Joi.string().trim().min(1).max(100).required(),
});

const listQuerySchema = Joi.object({
  status: Joi.string().valid(...DRIVE_STATUSES),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
  includeStats: Joi.boolean(),
}).unknown(true);

/** Trusted tenant + staff user; portal members can't run drives. */
function staffContext(req) {
  const tenantId = requireTenantId(req.tenantId || req.ctx?.tenantId);
  const userId = req.ctx?.userId || req.userId || req.user?.id;
  if (!userId) throw AppError.unauthorized("User context required");
  if (req.user?.userType && req.user.userType !== "CRM") {
    throw AppError.forbidden("Membership drives are available to staff users only");
  }
  return { tenantId, userId: String(userId) };
}

function validate(schema, value) {
  const { error, value: clean } = schema.validate(value || {}, { abortEarly: false });
  if (error) throw AppError.badRequest("Validation error: " + error.message);
  return clean;
}

exports.createDrive = async (req, res, next) => {
  try {
    const { tenantId, userId } = staffContext(req);
    const payload = validate(createSchema, req.body);
    const drive = await membershipDriveService.createDrive(tenantId, userId, payload);
    return res.success(drive);
  } catch (error) {
    return next(error);
  }
};

exports.listMyDrives = async (req, res, next) => {
  try {
    const { tenantId, userId } = staffContext(req);
    const query = validate(listQuerySchema, req.query);
    const result = await membershipDriveService.listMyDrives(tenantId, userId, query);
    if (query.includeStats) {
      result.drives = await Promise.all(
        result.drives.map(async (drive) => ({
          ...drive,
          stats: await membershipDriveService.computeStats(tenantId, drive),
        })),
      );
    }
    return res.success(result);
  } catch (error) {
    return next(error);
  }
};

exports.getDrive = async (req, res, next) => {
  try {
    const { tenantId } = staffContext(req);
    const drive = await membershipDriveService.getDrive(tenantId, req.params.id);
    return res.success(drive);
  } catch (error) {
    return next(error);
  }
};

exports.updateDrive = async (req, res, next) => {
  try {
    const { tenantId, userId } = staffContext(req);
    const payload = validate(updateSchema, req.body);
    const drive = await membershipDriveService.updateDrive(tenantId, userId, req.params.id, payload);
    return res.success(drive);
  } catch (error) {
    return next(error);
  }
};

exports.changeStatus = async (req, res, next) => {
  try {
    const { tenantId, userId } = staffContext(req);
    const { status } = validate(statusSchema, req.body);
    const drive = await membershipDriveService.changeStatus(tenantId, userId, req.params.id, status);
    return res.success(drive);
  } catch (error) {
    return next(error);
  }
};

exports.deleteDrive = async (req, res, next) => {
  try {
    const { tenantId, userId } = staffContext(req);
    const drive = await membershipDriveService.deactivateDrive(tenantId, userId, req.params.id);
    return res.success(drive);
  } catch (error) {
    return next(error);
  }
};

exports.linkRegistration = async (req, res, next) => {
  try {
    const { tenantId, userId } = staffContext(req);
    const { applicationId } = validate(registrationSchema, req.body);
    const result = await membershipDriveService.linkRegistration(
      tenantId,
      userId,
      req.params.id,
      applicationId,
    );
    return res.success(result);
  } catch (error) {
    return next(error);
  }
};

exports.unlinkRegistration = async (req, res, next) => {
  try {
    const { tenantId, userId } = staffContext(req);
    const result = await membershipDriveService.unlinkRegistration(
      tenantId,
      userId,
      req.params.id,
      req.params.applicationId,
    );
    return res.success(result);
  } catch (error) {
    return next(error);
  }
};

exports.getDriveStats = async (req, res, next) => {
  try {
    const { tenantId } = staffContext(req);
    const stats = await membershipDriveService.getDriveStats(tenantId, req.params.id);
    return res.success(stats);
  } catch (error) {
    return next(error);
  }
};

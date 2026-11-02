"use strict";
/**
 * P5 portal object authorization (PRE-UAT SECURITY BLOCKER - portal member object authorization).
 *
 * A permission code alone never grants access to every member object of the tenant: portal
 * MEMBER / NON-MEMBER roles carry profile:* / portal:* / application:* / payments:* codes, so the
 * routes below decide on the VERIFIED caller type first.
 *
 *   CRM staff  (userType "CRM")    -> the existing PDP permission (defaultPolicyMiddleware), tenant-scoped.
 *   PORTAL     (userType "PORTAL") -> self-service only: the target must be the caller's own profile,
 *                                     resolved from the verified user id (never a caller-supplied id).
 *   anything else                  -> denied.
 *
 * userType comes from the auth layer (gateway-verified JWT headers or a verified Bearer token, see
 * middlewares/auth.js and middlewares/internalTenant.js), never from the body/query.
 *
 * Known consequence (not changed here): the PDP currently admits few non-ASU CRM roles for the
 * profile / application / portal / payments resources (category rule). That is reviewed
 * separately; it is never compensated here by accepting a weaker check.
 */
const mongoose = require("mongoose");
const Profile = require("../models/profile.model.js");
const User = require("../models/user.model.js");
const PersonalDetails = require("../models/personal.details.model.js");
const { AppError } = require("../errors/AppError");
const { defaultPolicyMiddleware } = require("./policy.middleware");
const { resolveInternalCallerTenant } = require("./internalTenant.js");

const CRM_ONLY = "CRM_ONLY";
const NOT_OWNER = "NOT_OWNER";

function callerUserType(req) {
  const t = req.user && req.user.userType;
  return typeof t === "string" ? t.toUpperCase() : null;
}

function isCrmCaller(req) {
  return callerUserType(req) === "CRM";
}

function isPortalCaller(req) {
  return callerUserType(req) === "PORTAL";
}

function crmOnlyError() {
  return AppError.forbidden("This operation is restricted to CRM staff", { code: CRM_ONLY });
}

function notOwnerError() {
  return AppError.forbidden("You can only access your own member record", { code: NOT_OWNER });
}

/** Verified caller id (user-service id) as set by the auth layer. */
function verifiedCallerId(req) {
  const id = req.userId || (req.user && (req.user.id || req.user.sub));
  return id ? String(id) : null;
}

function callerTenantId(req) {
  const t = req.tenantId || (req.user && req.user.tenantId);
  return t ? String(t) : null;
}

/**
 * The caller's own profile, by the established binding only: the synced portal User (user-service
 * id -> local User._id) and Profile.userId, or the legacy Profile.userId == user-service id. No
 * email / membership-number matching and no linking side effect (that stays in /my-profile).
 * Cached on the request.
 */
async function resolveOwnProfile(req) {
  if (req._p5OwnProfile !== undefined) return req._p5OwnProfile;
  let own = null;
  const tenantId = callerTenantId(req);
  const userId = verifiedCallerId(req);
  if (isPortalCaller(req) && tenantId && userId) {
    const portalUser = await User.findOne({
      tenantId,
      userId,
      userType: "PORTAL",
      isActive: true,
    })
      .select("_id")
      .lean();
    const candidates = [];
    if (portalUser && portalUser._id) candidates.push(portalUser._id);
    if (mongoose.Types.ObjectId.isValid(userId)) candidates.push(new mongoose.Types.ObjectId(userId));
    if (candidates.length) {
      own = await Profile.findOne({ tenantId, isActive: true, userId: { $in: candidates } })
        .select("_id membershipNumber userId")
        .lean();
    }
  }
  req._p5OwnProfile = own || null;
  return req._p5OwnProfile;
}

async function resolveOwnProfileId(req) {
  const own = await resolveOwnProfile(req);
  return own && own._id ? String(own._id) : null;
}

function requireCrmUser(req, res, next) {
  if (isCrmCaller(req)) return next();
  return next(crmOnlyError());
}

/** Portal self-service routers: a CRM / unknown caller has no "own" portal object there. */
function requirePortalUser(req, res, next) {
  if (isPortalCaller(req)) return next();
  return next(AppError.forbidden("This endpoint is only available for Portal users", { code: "PORTAL_ONLY" }));
}

/** CRM staff only: CRM caller type, then the existing PDP permission. */
function requireCrm(resource, action) {
  const pdp = defaultPolicyMiddleware.requirePermission(resource, action);
  return [requireCrmUser, pdp];
}

/**
 * CRM with permission, or a PORTAL caller whose own profile id is `getTargetProfileId(req)`.
 * The portal branch is decided purely by comparing against the caller's own profile, so a
 * same-tenant other member, another tenant's profile and a missing id are indistinguishable (403).
 */
function crmOrOwnProfile(resource, action, getTargetProfileId) {
  const pdp = defaultPolicyMiddleware.requirePermission(resource, action);
  return async function crmOrOwnProfileMiddleware(req, res, next) {
    try {
      if (isCrmCaller(req)) return pdp(req, res, next);
      if (!isPortalCaller(req)) return next(crmOnlyError());
      const target = getTargetProfileId(req);
      const own = await resolveOwnProfileId(req);
      if (own && target != null && String(target) === own) return next();
      return next(notOwnerError());
    } catch (err) {
      return next(err);
    }
  };
}

/** Portal profile routes keyed by :profileId. */
function crmOrOwnProfileParam(resource, action, param = "profileId") {
  return crmOrOwnProfile(resource, action, (req) => {
    const v = req.params && req.params[param];
    return v == null ? null : String(v).replace(/\/$/, "");
  });
}

/**
 * Lookup endpoints that accept a list of keys (profile ids, user ids, membership numbers): CRM with
 * permission; a PORTAL caller only when EVERY requested key is its own (legitimate portal flows
 * - e.g. account-service resolving the caller's own membership number - ask for themselves only).
 * `ownKeysOf(own, req)` returns the caller's own keys (`own` is the caller's own profile or null);
 * `requestedKeysOf(req)` the requested ones.
 */
function crmOrSelfLookup(resource, action, { requestedKeysOf, ownKeysOf }) {
  const pdp = defaultPolicyMiddleware.requirePermission(resource, action);
  return async function crmOrSelfLookupMiddleware(req, res, next) {
    try {
      if (isCrmCaller(req)) return pdp(req, res, next);
      if (!isPortalCaller(req)) return next(crmOnlyError());
      const requested = (requestedKeysOf(req) || []).map((k) => String(k).trim()).filter(Boolean);
      // An empty request reaches the controller's own validation (400 / empty result).
      if (requested.length === 0) return next();
      const own = await resolveOwnProfile(req);
      const ownKeys = new Set(
        (ownKeysOf(own, req) || [])
          .filter((k) => k != null && k !== "")
          .map((k) => String(k).trim().toLowerCase()),
      );
      const allOwn = requested.every((k) => ownKeys.has(k.toLowerCase()));
      if (allOwn) return next();
      return next(notOwnerError());
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Pre-`authenticate` lookup routes (/profile/batch, /profile/internal/by-user-ids): a genuine
 * internal service call (x-internal-request with no user identity - the gateway strips the
 * header from clients) keeps working unchanged; a user identity must pass crmOrSelfLookup. A
 * request the tenant resolver rejects reaches the controller, which rejects it with its own
 * status/message.
 */
function internalOrCrmOrSelfLookup(resource, action, opts) {
  const userCheck = crmOrSelfLookup(resource, action, opts);
  return function internalOrCrmOrSelfLookupMiddleware(req, res, next) {
    const auth = resolveInternalCallerTenant(req, { requireInternalFlag: false });
    if (!auth.ok) return next();
    if (auth.mode === "internal") return next();
    return userCheck(req, res, next);
  };
}

/** profileIds from body.profileIds or query.profileIds (comma string or array), as the batch routes accept them. */
function requestedProfileIds(req) {
  const fromBody = req.body && req.body.profileIds;
  if (Array.isArray(fromBody)) return fromBody;
  const q = req.query && req.query.profileIds;
  if (typeof q === "string") return q.split(",");
  if (Array.isArray(q)) return q;
  return [];
}

/**
 * Application-step routes (/personal-details, /professional-details, /subscription-details keyed
 * by :applicationId). The application root (PersonalDetails) is bound to the portal member that
 * created it: PersonalDetails.userId == the verified user-service id (the token sub / gateway
 * x-user-id, see helpers/get.user.info.js). Every child step (professional / subscription) hangs
 * off that root, so ownership of the root decides ownership of the step - including a step that
 * does not exist yet (create).
 *
 *   CRM    -> the existing PDP permission (unchanged behaviour, tenant-scoped in the handlers).
 *   PORTAL -> the existing PDP permission AND the application must be the caller's own
 *             (same tenant AND same user). Another member's, another tenant's, a missing and a
 *             CRM-created (userId null) application are indistinguishable: 403 NOT_OWNER.
 *   other  -> 403 CRM_ONLY (fail closed; the services' `else` branches used to treat an unknown
 *             caller type as a portal caller with userId null, which matched userId-null records).
 */
async function isOwnApplication(req, applicationId) {
  const tenantId = callerTenantId(req);
  const userId = verifiedCallerId(req);
  if (!tenantId || !userId || applicationId == null || applicationId === "") return false;
  const appId = String(applicationId);
  const root = await PersonalDetails.findOne({
    tenantId,
    $or: [{ applicationId: appId }, { ApplicationId: appId }],
  })
    .select("userId")
    .lean();
  return Boolean(root && root.userId != null && String(root.userId) === userId);
}

function crmOrOwnApplication(resource, action, param = "applicationId") {
  const pdp = defaultPolicyMiddleware.requirePermission(resource, action);
  return async function crmOrOwnApplicationMiddleware(req, res, next) {
    try {
      if (isCrmCaller(req)) return pdp(req, res, next);
      if (!isPortalCaller(req)) return next(crmOnlyError());
      const applicationId = req.params && req.params[param];
      if (!(await isOwnApplication(req, applicationId))) return next(notOwnerError());
      return pdp(req, res, next);
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Application-step routes that are not keyed by an application id (create the root, "my"
 * details): CRM or PORTAL with the existing PDP permission; the controller binds a portal caller
 * to its verified user id. Anything else is denied.
 */
function crmOrPortal(resource, action) {
  const pdp = defaultPolicyMiddleware.requirePermission(resource, action);
  return function crmOrPortalMiddleware(req, res, next) {
    if (isCrmCaller(req) || isPortalCaller(req)) return pdp(req, res, next);
    return next(crmOnlyError());
  };
}

module.exports = {
  CRM_ONLY,
  NOT_OWNER,
  callerUserType,
  isCrmCaller,
  isPortalCaller,
  verifiedCallerId,
  resolveOwnProfile,
  resolveOwnProfileId,
  requireCrmUser,
  requirePortalUser,
  requireCrm,
  internalOrCrmOrSelfLookup,
  requestedProfileIds,
  crmOrOwnProfile,
  crmOrOwnProfileParam,
  crmOrSelfLookup,
  crmOrOwnApplication,
  crmOrPortal,
  isOwnApplication,
  crmOnlyError,
  notOwnerError,
};

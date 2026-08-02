const mongoose = require("mongoose");
const groupService = require("../services/group.service");
const { AppError } = require("../errors/AppError");
const Group = require("../models/group.model");

const MEMBERSHIP_MODES = Group.MEMBERSHIP_MODES || ["STATIC", "DYNAMIC"];

function normalizeStringArray(value) {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map((v) => String(v).trim()).filter(Boolean);
}

function normalizeCriteria(criteria = {}) {
  return {
    workLocation: normalizeStringArray(criteria.workLocation),
    section: normalizeStringArray(criteria.section),
    grade: normalizeStringArray(criteria.grade),
    branch: normalizeStringArray(criteria.branch),
    region: normalizeStringArray(criteria.region),
    iroUserId: criteria.iroUserId ? String(criteria.iroUserId).trim() : null,
    membershipCategory: normalizeStringArray(criteria.membershipCategory),
  };
}

/** partial=true (PUT) only validates/applies fields actually present on the body. */
function buildGroupPayload(body = {}, { partial = false } = {}) {
  const payload = {};

  if (!partial || body.name !== undefined) {
    if (!body.name || !String(body.name).trim()) {
      throw AppError.badRequest("name is required");
    }
    payload.name = String(body.name).trim();
  }

  if (body.description !== undefined) {
    payload.description =
      body.description != null ? String(body.description).trim() : null;
  }

  if (!partial || body.membershipMode !== undefined) {
    const mode = String(body.membershipMode || "STATIC").toUpperCase();
    if (!MEMBERSHIP_MODES.includes(mode)) {
      throw AppError.badRequest(
        `membershipMode must be one of: ${MEMBERSHIP_MODES.join(", ")}`,
      );
    }
    payload.membershipMode = mode;
  }

  if (body.staticMemberIds !== undefined) {
    payload.staticMemberIds = normalizeStringArray(body.staticMemberIds);
  }

  if (body.criteria !== undefined) {
    payload.criteria = normalizeCriteria(body.criteria);
  }

  if (body.isActive !== undefined) {
    payload.isActive = !!body.isActive;
  }

  return payload;
}

function resolveTenantId(req) {
  return req.tenantId || req.ctx?.tenantId || null;
}

exports.createGroup = async (req, res, next) => {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return next(AppError.badRequest("Tenant context required"));

    const payload = buildGroupPayload(req.body, { partial: false });
    const group = await groupService.createGroup(tenantId, req.userId, payload);
    return res.success(group, "Group created successfully");
  } catch (error) {
    if (error.isJoi) return next(AppError.badRequest("Validation error: " + error.message));
    return next(error);
  }
};

exports.listGroups = async (req, res, next) => {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return next(AppError.badRequest("Tenant context required"));

    const result = await groupService.listGroups(tenantId, req.query || {});
    return res.success(result);
  } catch (error) {
    return next(error);
  }
};

exports.getGroupById = async (req, res, next) => {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return next(AppError.badRequest("Tenant context required"));

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(AppError.badRequest("Invalid group id"));
    }

    const group = await groupService.getGroupById(tenantId, id);
    if (!group) return res.notFoundRecord("Group not found");
    return res.success(group);
  } catch (error) {
    return next(error);
  }
};

exports.updateGroup = async (req, res, next) => {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return next(AppError.badRequest("Tenant context required"));

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(AppError.badRequest("Invalid group id"));
    }

    const payload = buildGroupPayload(req.body, { partial: true });
    const group = await groupService.updateGroup(tenantId, id, payload);
    if (!group) return res.notFoundRecord("Group not found");
    return res.success(group, "Group updated successfully");
  } catch (error) {
    if (error.isJoi) return next(AppError.badRequest("Validation error: " + error.message));
    return next(error);
  }
};

exports.deleteGroup = async (req, res, next) => {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return next(AppError.badRequest("Tenant context required"));

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(AppError.badRequest("Invalid group id"));
    }

    const group = await groupService.deleteGroup(tenantId, id);
    if (!group) return res.notFoundRecord("Group not found");
    return res.success(null, "Group deleted successfully");
  } catch (error) {
    return next(error);
  }
};

/**
 * GET /groups/:id/members — core membership-resolution endpoint. STATIC returns the stored
 * member ids resolved against Profile; DYNAMIC builds and runs a live query from the group's
 * criteria (see services/group.service.js's buildDynamicMemberQuery). Always re-evaluated,
 * never cached, for both modes.
 */
exports.getGroupMembers = async (req, res, next) => {
  try {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return next(AppError.badRequest("Tenant context required"));

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(AppError.badRequest("Invalid group id"));
    }

    const group = await groupService.getGroupById(tenantId, id);
    if (!group) return res.notFoundRecord("Group not found");

    const result = await groupService.resolveGroupMembers(group);

    return res.success({
      groupId: group._id,
      name: group.name,
      membershipMode: group.membershipMode,
      total: result.total,
      members: result.members,
      // Criteria that could not be safely translated into a Profile query (e.g. iroUserId) — see
      // buildDynamicMemberQuery's comments. Empty for STATIC groups.
      unresolvedCriteria: result.unresolvedCriteria,
    });
  } catch (error) {
    return next(error);
  }
};

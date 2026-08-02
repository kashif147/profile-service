const mongoose = require("mongoose");
const Group = require("../models/group.model");
const Profile = require("../models/profile.model");
const {
  enrichPersonalInfoFullNameOnDocuments,
} = require("../helpers/personal.info.fullName.js");

/**
 * Same projection profile.controller.js's cross-service/batch profile lookups already use
 * (BATCH_PROFILE_LOOKUP_SELECT) — reused here so Group member results carry the same shape
 * (name, membership no, workLocation/branch/region/grade, contact info) other member-list
 * consumers (MemberSearch, batch lookup) already expect, rather than inventing a new one.
 */
const PROFILE_MEMBER_PROJECTION =
  "membershipNumber personalInfo contactInfo professionalDetails preferences tenantId isActive";

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeArrayFilter(values) {
  return Array.isArray(values)
    ? values.filter((v) => v != null && String(v).trim() !== "")
    : [];
}

async function createGroup(tenantId, userId, payload) {
  const group = new Group({
    ...payload,
    tenantId,
    createdBy: userId || null,
  });
  const saved = await group.save();
  return saved.toObject();
}

function buildListQuery(tenantId, filters = {}) {
  const query = { tenantId };

  if (filters.isActive !== undefined) {
    query.isActive = filters.isActive === "true" || filters.isActive === true;
  } else {
    // Default: hide soft-deleted (isActive:false) groups unless explicitly requested.
    query.isActive = { $ne: false };
  }

  const and = [];
  if (filters.search) {
    const regex = new RegExp(escapeRegex(filters.search), "i");
    and.push({ $or: [{ name: regex }, { description: regex }] });
  }
  // These drill down to "which group(s) touch this workplace/branch/region/IRO" — array-field
  // equality match (Mongo matches an array field containing the scalar automatically).
  if (filters.workplace) and.push({ "criteria.workLocation": filters.workplace });
  if (filters.branch) and.push({ "criteria.branch": filters.branch });
  if (filters.region) and.push({ "criteria.region": filters.region });
  if (filters.iroUserId) and.push({ "criteria.iroUserId": filters.iroUserId });
  if (and.length > 0) query.$and = and;

  return query;
}

async function listGroups(tenantId, filters = {}) {
  const query = buildListQuery(tenantId, filters);
  const page = Math.max(parseInt(filters.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 100, 1), 500);
  const skip = (page - 1) * limit;

  const [groups, total] = await Promise.all([
    Group.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Group.countDocuments(query),
  ]);

  return { groups, total, page, limit };
}

async function getGroupDocument(tenantId, groupId) {
  return Group.findOne({ _id: groupId, tenantId });
}

async function getGroupById(tenantId, groupId) {
  return Group.findOne({ _id: groupId, tenantId }).lean();
}

async function updateGroup(tenantId, groupId, payload) {
  const group = await getGroupDocument(tenantId, groupId);
  if (!group) return null;
  Object.assign(group, payload);
  const saved = await group.save();
  return saved.toObject();
}

/** Soft delete — flips isActive off rather than removing the document (other services may
 * already hold a Group._id reference, e.g. a planned Issue.groupId in issue-service). */
async function deleteGroup(tenantId, groupId) {
  const group = await getGroupDocument(tenantId, groupId);
  if (!group) return null;
  group.isActive = false;
  const saved = await group.save();
  return saved.toObject();
}

/**
 * Builds the live Mongo query for a DYNAMIC group's criteria against Profile/professionalDetails.
 *
 * Returns { query, unresolvedCriteria } — unresolvedCriteria lists criteria keys present on the
 * group that could NOT be safely translated into a Profile filter, so callers (controller/UI) can
 * surface that the returned member list may be incomplete instead of silently dropping the
 * criterion.
 *
 * Field-mapping notes:
 * - workLocation / grade / branch / region map directly onto the matching
 *   `professionalDetails.*` field on Profile (confirmed in models/profile.model.js and mirrored by
 *   services/universal.search.service.js's own filter-building for the same fields).
 * - `section` has no single generic field on Profile — only `primarySection`/`secondarySection`
 *   exist (models/profile.model.js, models/professional.details.model.js). Mapped to
 *   `professionalDetails.primarySection`, matching universal.search.service.js's own "Section
 *   filter" convention (secondarySection is intentionally not matched, same as that convention).
 * - `membershipCategory` is NOT reliably stored on Profile.professionalDetails in current data —
 *   it's owned by subscription-service and only enriched onto a Profile at *read* time via a
 *   per-profile HTTP call (controllers/profile.controller.js's fetchCurrentSubscriptionByProfileId).
 *   This filter will only match profiles that happen to carry professionalDetails.membershipCategory
 *   directly (legacy/portal writes via helpers/membershipCategory.helper.js) and will silently miss
 *   any profile whose category only lives in subscription-service. Kept because the spec's example
 *   list treats it the same as workLocation/section/grade/branch/region, but this is a known gap,
 *   not a verified resolution — same caveat class as iroUserId below.
 * - `iroUserId` is intentionally NOT translated into a Mongo filter at all. There is no
 *   iroUserId/officer field anywhere on Profile (confirmed by grep across profile-service). IRO is
 *   resolved via user-service's WORKLOC Lookup.officer field
 *   (Profile.professionalDetails.workLocation -> user-service Lookup -> .officer), a two-hop
 *   cross-service lookup. This service's existing services/lookup.service.client.js only resolves a
 *   single named work location's `processSalaryDeduction` flag — it has no reverse
 *   "officer -> workLocations" capability today, and no bulk WORKLOC-list-with-officer fetch either.
 *   Guessing at that resolution here would silently return a wrong/incomplete member list, so this
 *   criterion is left as a documented no-op (reported via unresolvedCriteria) rather than a guess.
 */
function buildDynamicMemberQuery(tenantId, criteria = {}) {
  const query = { tenantId };
  const unresolvedCriteria = [];

  const applyArrayFilter = (key, path) => {
    const values = normalizeArrayFilter(criteria[key]);
    if (values.length > 0) {
      query[path] = { $in: values };
    }
  };

  applyArrayFilter("workLocation", "professionalDetails.workLocation");
  applyArrayFilter("section", "professionalDetails.primarySection");
  applyArrayFilter("grade", "professionalDetails.grade");
  applyArrayFilter("branch", "professionalDetails.branch");
  applyArrayFilter("region", "professionalDetails.region");
  applyArrayFilter("membershipCategory", "professionalDetails.membershipCategory");

  if (criteria.iroUserId) {
    unresolvedCriteria.push("iroUserId");
  }

  return { query, unresolvedCriteria };
}

async function fetchProfilesByQuery(query) {
  const profiles = await Profile.find(query)
    .select(PROFILE_MEMBER_PROJECTION)
    .lean();
  enrichPersonalInfoFullNameOnDocuments(profiles);
  return profiles;
}

/**
 * Core membership-resolution logic. Always re-evaluated live — no caching, per the
 * "dynamic re-evaluated at runtime" requirement (and STATIC has nothing to cache in the first
 * place, it's a direct lookup by stored ids).
 */
async function resolveGroupMembers(group) {
  const tenantId = group.tenantId;

  if (group.membershipMode === "STATIC") {
    const ids = (group.staticMemberIds || []).filter((id) =>
      mongoose.Types.ObjectId.isValid(id),
    );
    if (ids.length === 0) {
      return { members: [], total: 0, unresolvedCriteria: [] };
    }
    const members = await fetchProfilesByQuery({
      _id: { $in: ids },
      tenantId,
    });
    return { members, total: members.length, unresolvedCriteria: [] };
  }

  // DYNAMIC
  const { query, unresolvedCriteria } = buildDynamicMemberQuery(
    tenantId,
    group.criteria || {},
  );
  const members = await fetchProfilesByQuery(query);
  return { members, total: members.length, unresolvedCriteria };
}

module.exports = {
  createGroup,
  listGroups,
  getGroupById,
  updateGroup,
  deleteGroup,
  resolveGroupMembers,
  buildDynamicMemberQuery,
};

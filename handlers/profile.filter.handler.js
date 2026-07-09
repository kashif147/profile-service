const Profile = require("../models/profile.model");
const {
  FILTER_OPERATOR,
  PROFILE_FILTER_FIELD_MAP,
} = require("../constants/enums");

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const EXACT_STRING_KEYS = new Set([
  "mobileNumber",
  "preferredEmail",
  "personalEmail",
  "workEmail",
]);

function buildProfileFilterConditions(filters = {}) {
  const conditions = [];

  for (const [filterKey, filterEntry] of Object.entries(filters || {})) {
    if (
      !filterEntry ||
      !Array.isArray(filterEntry.values) ||
      filterEntry.values.length === 0
    ) {
      continue;
    }

    const resolvedKey = Object.keys(PROFILE_FILTER_FIELD_MAP).find(
      (k) =>
        k.toLowerCase() === (filterKey && String(filterKey).toLowerCase()),
    );
    const path = resolvedKey ? PROFILE_FILTER_FIELD_MAP[resolvedKey] : null;
    if (!path) continue;

    const equal = filterEntry.operator === FILTER_OPERATOR.EQUAL_TO;
    const mongoOp = equal ? "$in" : "$nin";
    const values = filterEntry.values.map((v) =>
      typeof v === "string" ? v.trim() : v,
    );

    if (path === "isActive") {
      const bools = values
        .map((v) => {
          if (typeof v === "boolean") return v;
          const s = String(v).toLowerCase();
          if (s === "true" || s === "1") return true;
          if (s === "false" || s === "0") return false;
          return null;
        })
        .filter((b) => typeof b === "boolean");
      if (bools.length === 0) continue;
      conditions.push({ [path]: { [mongoOp]: bools } });
      continue;
    }

    if (resolvedKey === "grade") {
      const regexes = values.map(
        (v) => new RegExp(`^${escapeRegex(String(v))}$`, "i"),
      );
      conditions.push({ [path]: { [mongoOp]: regexes } });
      continue;
    }

    if (resolvedKey === "submissionDate") {
      const dates = values
        .map((v) => new Date(v))
        .filter((d) => !Number.isNaN(d.getTime()));
      if (dates.length === 0) continue;
      conditions.push({ [path]: { [mongoOp]: dates } });
      continue;
    }

    if (EXACT_STRING_KEYS.has(resolvedKey)) {
      conditions.push({
        [path]: { [mongoOp]: values.map((v) => String(v)) },
      });
      continue;
    }

    const regexes = values.map(
      (v) => new RegExp(`^${escapeRegex(String(v))}$`, "i"),
    );
    conditions.push({ [path]: { [mongoOp]: regexes } });
  }

  return conditions;
}

/**
 * Paginated profiles for tenant with template filter conditions (Profile collection only).
 */
exports.getProfilesWithTemplateFilters = async (
  tenantId,
  filters = {},
  page = 1,
  limit = 500,
) => {
  const conds = buildProfileFilterConditions(filters);
  const baseQuery = { tenantId, isActive: { $ne: false } };
  const query =
    conds.length > 0 ? { $and: [baseQuery, ...conds] } : baseQuery;

  const skip = (page - 1) * limit;

  const [profiles, total] = await Promise.all([
    Profile.find(query)
      .populate("crmUserId", "userFullName")
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Profile.countDocuments(query),
  ]);

  return {
    profiles,
    total,
    page,
    limit,
  };
};

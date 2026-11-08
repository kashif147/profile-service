"use strict";
/**
 * PDP rollout P5 prerequisite (blocker 1: staff actions that audience enforcement would newly permit outside the
 * P8 role targets). Local, literal checks mounted AFTER the existing requireCrm(...) PDP guard, so they only ever
 * narrow access; they never call the PDP and never consult role permissions from the database.
 *
 *   requireTenantAdmin            profile soft delete, batch delete: only the tenant administrator (ASU, whose
 *                                 verified token carries the computed own-tenant wildcard "*").
 *   requireDuplicateMergeAuthority duplicate merge (membership-office workflow): "*" OR the literal claims
 *                                 profile:read AND profile:write. Deliberately separate from general delete: the
 *                                 merge keeps one profile, re-points references and deactivates the absorbed
 *                                 profile (isActive:false, mergedIntoProfileId) - it never hard-deletes - so it is
 *                                 a profile write workflow, not a delete grant.
 *   requireFinanceActionRole      CRM payment-form writes: "*" OR (a finance action role AND the literal claim
 *                                 payments:write) - the same role set as account-service FINANCE_ACTION_ROLES.
 *
 * Caller facts come only from the verified identity (req.user set by middlewares/auth.js from gateway-verified
 * headers or a verified Bearer token). Any non-CRM caller is refused (CRM_ONLY), fail closed.
 */
const { AppError } = require("../errors/AppError");

const TENANT_ADMIN_REQUIRED = "TENANT_ADMIN_REQUIRED";
const DUPLICATE_MERGE_NOT_PERMITTED = "DUPLICATE_MERGE_NOT_PERMITTED";
const FINANCE_ACTION_ROLE_REQUIRED = "FINANCE_ACTION_ROLE_REQUIRED";
const TENANT_WILDCARD = "*";

// Mirror of account-service src/helpers/financePermissions.js FINANCE_ACTION_ROLES (codes and display names).
const FINANCE_ACTION_ROLES = Object.freeze(new Set([
  "ASU",
  "ASSISTANT SUPER USER",
  "AM",
  "ACCOUNTS MANAGER",
  "ACCOUNT MANAGER",
  "DAM",
  "DEPUTY ACCOUNTS MANAGER",
  "DEPUTY ACCOUNT MANAGER",
]));

function isCrm(req) {
  const t = req && req.user && req.user.userType;
  return typeof t === "string" && t.toUpperCase() === "CRM";
}

function claims(req) {
  const out = [];
  for (const src of [req && req.user && req.user.permissions, req && req.permissions]) {
    if (Array.isArray(src)) out.push(...src.filter((p) => typeof p === "string"));
  }
  return out;
}

function roleCodes(req) {
  const out = [];
  for (const src of [req && req.user && req.user.roles, req && req.roles]) {
    if (!Array.isArray(src)) continue;
    for (const r of src) {
      const code = typeof r === "string" ? r : r && r.code;
      if (typeof code === "string" && code.trim()) out.push(code.trim().toUpperCase());
    }
  }
  return out;
}

const crmOnly = () => new AppError("This action is restricted to CRM staff", 403, "CRM_ONLY");
const refuse = (message, code) => new AppError(message, 403, code);

function requireTenantAdmin(req, res, next) {
  if (!isCrm(req)) return next(crmOnly());
  if (claims(req).includes(TENANT_WILDCARD)) return next();
  return next(refuse("This action is restricted to the tenant administrator", TENANT_ADMIN_REQUIRED));
}

function requireDuplicateMergeAuthority(req, res, next) {
  if (!isCrm(req)) return next(crmOnly());
  const c = claims(req);
  if (c.includes(TENANT_WILDCARD) || (c.includes("profile:read") && c.includes("profile:write"))) return next();
  return next(refuse("Duplicate merge requires profile read and write authority", DUPLICATE_MERGE_NOT_PERMITTED));
}

function requireFinanceActionRole(req, res, next) {
  if (!isCrm(req)) return next(crmOnly());
  const c = claims(req);
  if (c.includes(TENANT_WILDCARD)) return next();
  if (c.includes("payments:write") && roleCodes(req).some((r) => FINANCE_ACTION_ROLES.has(r))) return next();
  return next(refuse("Payment-form changes require a finance action role with payments:write", FINANCE_ACTION_ROLE_REQUIRED));
}

module.exports = {
  TENANT_ADMIN_REQUIRED,
  DUPLICATE_MERGE_NOT_PERMITTED,
  FINANCE_ACTION_ROLE_REQUIRED,
  FINANCE_ACTION_ROLES,
  requireTenantAdmin,
  requireDuplicateMergeAuthority,
  requireFinanceActionRole,
};

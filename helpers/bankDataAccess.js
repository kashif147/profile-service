"use strict";
/**
 * PDP rollout P3 (Q2): bank-sensitive payment-form data.
 *
 * Plaintext debtor IBAN / BIC (form detail, CRM write responses, the CRM PDF download and the SEPA
 * mandates-for-prepare feed) is released only to a CRM caller whose verified permissions carry
 * `payments.bank:read` (catalogue code PAYMENTS.BANK_READ; user-service role.handler.js getUserPermissions
 * issues `${resource}:${action}` lower-cased) or the tenant wildcard `*` (computed for ASU only).
 * Literal match only and fail closed: `payments:read` / `payments:*` / `admin` never unlock it, and the
 * check never goes through the PDP (until the P1 catalogue PR, `payments.bank` is an unknown resource
 * there and would deny everyone). Permissions come from the auth layer (req.user / req.permissions), never
 * from the body or query.
 */
const { AppError } = require("../errors/AppError.js");

const BANK_READ_PERMISSION = "payments.bank:read";
const BANK_READ_CLAIMS = Object.freeze(["*", BANK_READ_PERMISSION]);
const BANK_DATA_PERMISSION_REQUIRED = "BANK_DATA_PERMISSION_REQUIRED";

function callerPermissions(req) {
  const out = [];
  for (const src of [req && req.user && req.user.permissions, req && req.permissions]) {
    if (Array.isArray(src)) out.push(...src);
  }
  return out;
}

function canReadBankData(req) {
  const userType = req && req.user && typeof req.user.userType === "string" ? req.user.userType.toUpperCase() : "";
  if (userType !== "CRM") return false;
  const perms = callerPermissions(req);
  return BANK_READ_CLAIMS.some((p) => perms.includes(p));
}

function bankDataRequiredError() {
  return AppError.forbidden("Bank data permission required (payments.bank:read)", {
    code: BANK_DATA_PERMISSION_REQUIRED,
  });
}

/** Route gate for outputs that only exist in plaintext (the SEPA mandates feed). */
function requireBankDataRead(req, res, next) {
  if (canReadBankData(req)) return next();
  return next(bankDataRequiredError());
}

module.exports = {
  BANK_READ_PERMISSION,
  BANK_DATA_PERMISSION_REQUIRED,
  canReadBankData,
  requireBankDataRead,
  bankDataRequiredError,
};

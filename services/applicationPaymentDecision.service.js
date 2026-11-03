/**
 * P5 bound payment commands (S2, caller side): the committed approve/reject decision claim for an
 * application.
 *
 * Before profile-service asks account-service to capture or cancel an application payment, the
 * decision is claimed with ONE conditional update on PersonalDetails, committed on its own (not
 * inside the approval transaction). That gives every capture/cancel a persisted business decision
 * behind it, and makes approve and reject mutually exclusive: a reject can never cancel a hold
 * that an in-flight approve is capturing, and vice versa.
 *
 * - Same action again (retry after a failed attempt, a double click, or a crash) re-uses the claim:
 *   the payment command is state-idempotent on account's side, so re-running the action is the
 *   recovery path.
 * - The opposite action while a claim is held -> 409 PAYMENT_DECISION_CONFLICT, nothing called.
 * - A final application (processed / rejected) is never claimed -> 409 APPLICATION_ALREADY_DECIDED.
 * - Released only when the action failed BEFORE any payment command succeeded. Once money moved
 *   (captured / hold released) the claim stays, so the opposite action stays blocked.
 */
const crypto = require("crypto");
const PersonalDetails = require("../models/personal.details.model.js");
const { AppError } = require("../errors/AppError");
const { APPLICATION_STATUS } = require("../constants/enums");

const FINAL = [APPLICATION_STATUS.PROCESSED, APPLICATION_STATUS.REJECTED];
const ACTIONS = new Set(["approve", "reject"]);

function conflict(code, message) {
  return new AppError(message, 409, code);
}

async function claimPaymentDecision({ applicationId, tenantId, action, actorUserId }) {
  if (!ACTIONS.has(action)) throw new Error(`unknown payment decision action ${action}`);
  if (!tenantId) throw AppError.forbidden("Tenant context is required");
  const claimId = crypto.randomUUID();
  const base = { applicationId, tenantId: String(tenantId), applicationStatus: { $nin: FINAL } };

  // Fresh claim (no decision held yet).
  let doc = await PersonalDetails.findOneAndUpdate(
    { ...base, $or: [{ "paymentDecision.action": { $exists: false } }, { "paymentDecision.action": null }] },
    {
      $set: {
        paymentDecision: {
          action,
          claimId,
          actorUserId: actorUserId ? String(actorUserId) : null,
          claimedAt: new Date(),
        },
      },
    },
    { new: true },
  );
  if (doc) return { claimId, reused: false };

  // Same action already claimed: re-use it (retry / recovery).
  doc = await PersonalDetails.findOne({ ...base, "paymentDecision.action": action })
    .select("paymentDecision")
    .lean();
  if (doc) return { claimId: doc.paymentDecision.claimId, reused: true };

  const current = await PersonalDetails.findOne({ applicationId, tenantId: String(tenantId) })
    .select("applicationStatus paymentDecision")
    .lean();
  if (!current) throw AppError.notFound("Application not found");
  if (FINAL.includes(current.applicationStatus)) {
    throw conflict("APPLICATION_ALREADY_DECIDED", "Application has already been processed.");
  }
  throw conflict(
    "PAYMENT_DECISION_CONFLICT",
    `A ${current.paymentDecision?.action || "different"} decision is already in progress for this application.`,
  );
}

/** Drops the claim only while it is still ours and the application is not final. Best-effort. */
async function releasePaymentDecision({ applicationId, tenantId, claimId }) {
  if (!claimId) return;
  await PersonalDetails.updateOne(
    {
      applicationId,
      tenantId: String(tenantId),
      applicationStatus: { $nin: FINAL },
      "paymentDecision.claimId": claimId,
    },
    { $unset: { paymentDecision: "" } },
  ).catch(() => {});
}

module.exports = { claimPaymentDecision, releasePaymentDecision };

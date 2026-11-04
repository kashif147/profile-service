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
 * - P5 execution lease: each running attempt of the action holds a lease (leaseId, leaseUntil). A
 *   second concurrent run of the same action gets 409 DECISION_IN_PROGRESS instead of sharing the
 *   claim, so a failing duplicate can never release a claim another request is still acting on.
 *   Release and lease-end are bound to the lease; an expired lease (crash) is taken over by the
 *   next run of the same action. The approve claim also records the duplicate-review version it
 *   was made against (paymentDecision.reviewVersion).
 * - P5 operation keys: a run started with a client Idempotency-Key records it on the claim
 *   (paymentDecision.operationKeys, last 20). Once the decision completed, the same action with a
 *   recorded key is a replay (findDecisionReplay) and returns the recorded outcome instead of 409
 *   APPLICATION_ALREADY_DECIDED; any other key still gets the 409.
 */
const crypto = require("crypto");
const PersonalDetails = require("../models/personal.details.model.js");
const { AppError } = require("../errors/AppError");
const { APPLICATION_STATUS } = require("../constants/enums");

const FINAL = [APPLICATION_STATUS.PROCESSED, APPLICATION_STATUS.REJECTED];
const ACTIONS = new Set(["approve", "reject"]);
// Longer than one approval run (transaction retries + capture); short enough for crash recovery.
const DECISION_LEASE_MS = Number(process.env.PAYMENT_DECISION_LEASE_MS) || 120000;

function conflict(code, message) {
  return new AppError(message, 409, code);
}

const MAX_OPERATION_KEYS = 20;

async function claimPaymentDecision({ applicationId, tenantId, action, actorUserId, reviewVersion, operationKey }) {
  if (!ACTIONS.has(action)) throw new Error(`unknown payment decision action ${action}`);
  if (!tenantId) throw AppError.forbidden("Tenant context is required");
  const claimId = crypto.randomUUID();
  const leaseId = crypto.randomUUID();
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + DECISION_LEASE_MS);
  const base = { applicationId, tenantId: String(tenantId), applicationStatus: { $nin: FINAL } };
  const versionSet = Number.isInteger(reviewVersion) ? { "paymentDecision.reviewVersion": reviewVersion } : {};

  let doc = await PersonalDetails.findOneAndUpdate(
    { ...base, $or: [{ "paymentDecision.action": { $exists: false } }, { "paymentDecision.action": null }] },
    {
      $set: {
        paymentDecision: {
          action,
          claimId,
          actorUserId: actorUserId ? String(actorUserId) : null,
          claimedAt: now,
          leaseId,
          leaseUntil,
          ...(Number.isInteger(reviewVersion) ? { reviewVersion } : {}),
          ...(operationKey ? { operationKeys: [String(operationKey)] } : {}),
        },
      },
    },
    { new: true },
  );
  if (doc) return { claimId, leaseId, reused: false };

  // Same action already claimed: take the lease only if no other run currently holds it.
  doc = await PersonalDetails.findOneAndUpdate(
    {
      ...base,
      "paymentDecision.action": action,
      $or: [
        { "paymentDecision.leaseUntil": { $exists: false } },
        { "paymentDecision.leaseUntil": null },
        { "paymentDecision.leaseUntil": { $lte: now } },
      ],
    },
    {
      $set: { "paymentDecision.leaseId": leaseId, "paymentDecision.leaseUntil": leaseUntil, ...versionSet },
      ...(operationKey
        ? { $push: { "paymentDecision.operationKeys": { $each: [String(operationKey)], $slice: -MAX_OPERATION_KEYS } } }
        : {}),
    },
    { new: true },
  );
  if (doc) return { claimId: doc.paymentDecision.claimId, leaseId, reused: true };

  const current = await PersonalDetails.findOne({ applicationId, tenantId: String(tenantId) })
    .select("applicationStatus paymentDecision")
    .lean();
  if (!current) throw AppError.notFound("Application not found");
  if (FINAL.includes(current.applicationStatus)) {
    throw conflict("APPLICATION_ALREADY_DECIDED", "Application has already been processed.");
  }
  if (current.paymentDecision?.action === action) {
    throw conflict(
      "DECISION_IN_PROGRESS",
      `This ${action} is already in progress for this application. Wait for it to finish, then refresh.`,
    );
  }
  throw conflict(
    "PAYMENT_DECISION_CONFLICT",
    `A ${current.paymentDecision?.action || "different"} decision is already in progress for this application.`,
  );
}

/**
 * A completed decision of `action` that recorded `operationKey`: the original outcome, or null.
 * Tenant-scoped; never matches another tenant's application.
 */
async function findDecisionReplay({ applicationId, tenantId, action, operationKey }) {
  if (!operationKey || !tenantId) return null;
  const status = action === "approve" ? APPLICATION_STATUS.PROCESSED : APPLICATION_STATUS.REJECTED;
  const doc = await PersonalDetails.findOne({
    applicationId,
    tenantId: String(tenantId),
    applicationStatus: status,
    "paymentDecision.action": action,
    "paymentDecision.operationKeys": String(operationKey),
  })
    .select("applicationId applicationStatus profileId paymentDecision.reviewVersion")
    .lean();
  if (!doc) return null;
  return {
    applicationId: doc.applicationId,
    applicationStatus: doc.applicationStatus,
    profileId: doc.profileId ? String(doc.profileId) : null,
    reviewVersion: doc.paymentDecision?.reviewVersion ?? null,
  };
}

function leaseFilter(applicationId, tenantId, claimId, leaseId) {
  return {
    applicationId,
    tenantId: String(tenantId),
    applicationStatus: { $nin: FINAL },
    "paymentDecision.claimId": claimId,
    ...(leaseId ? { "paymentDecision.leaseId": leaseId } : {}),
  };
}

/**
 * Drops the claim only while it is still ours (same claim AND, when given, the same lease) and the
 * application is not final. Best-effort.
 */
async function releasePaymentDecision({ applicationId, tenantId, claimId, leaseId }) {
  if (!claimId) return;
  await PersonalDetails.updateOne(leaseFilter(applicationId, tenantId, claimId, leaseId), {
    $unset: { paymentDecision: "" },
  }).catch(() => {});
}

/**
 * Keeps the claim (money moved) but ends this run's lease, so re-running the same action - the
 * recovery path - can proceed immediately instead of waiting for the lease to expire. Best-effort.
 */
async function endPaymentDecisionLease({ applicationId, tenantId, claimId, leaseId }) {
  if (!claimId || !leaseId) return;
  await PersonalDetails.updateOne(leaseFilter(applicationId, tenantId, claimId, leaseId), {
    $unset: { "paymentDecision.leaseId": "", "paymentDecision.leaseUntil": "" },
  }).catch(() => {});
}

module.exports = {
  claimPaymentDecision,
  releasePaymentDecision,
  endPaymentDecisionLease,
  findDecisionReplay,
  DECISION_LEASE_MS,
};

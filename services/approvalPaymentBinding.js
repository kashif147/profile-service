"use strict";
/**
 * P5: the payment an application decision captures (approve) or cancels (reject) must be bound to
 * THAT application in the caller's verified tenant. Fail closed, before any payment command:
 *
 * - LINK mode: the PaymentIntent comes from the application's own `payment` record, written only
 *   by tenant-envelope-checked account events for this application and its current linkVersion
 *   (applicationPaymentLink.service.js), so it is bound by construction.
 * - INLINE mode: the PaymentIntent must come from account-service's tenant-scoped
 *   GET /payments/applications/:applicationId/latest (the request's tenant header scopes it), and
 *   that record must name this application and this PaymentIntent:
 *     - no account record (only a locally stored SubscriptionDetails.paymentDetails intent), or a
 *       record without an applicationId          -> 409 PAYMENT_BINDING_MISSING
 *     - a record for another application, or a different PaymentIntent
 *                                                 -> 409 PAYMENT_APPLICATION_MISMATCH
 *
 * account-service's bound command (paymentBoundCommand.service.js) re-checks the stored row's
 * authoritative application binding server-side; this is the profile-side mirror, which also
 * covers the legacy (unbound) command mode.
 */
const { AppError } = require("../errors/AppError.js");

const norm = (v) => (v == null ? "" : String(v).trim());

function assertApprovalPaymentBinding({ applicationId, paymentIntentId, latestPayment, mode = "INLINE" }) {
  const intent = norm(paymentIntentId);
  if (!intent) return; // nothing to capture / cancel
  if (mode === "LINK") return;
  if (!latestPayment || !norm(latestPayment.applicationId)) {
    throw new AppError(
      "The payment for this application could not be verified as bound to it. Nothing was charged or released.",
      409,
      "PAYMENT_BINDING_MISSING",
    );
  }
  if (norm(latestPayment.applicationId) !== norm(applicationId) || norm(latestPayment.paymentIntentId) !== intent) {
    throw new AppError(
      "The payment found is bound to a different application. Nothing was charged or released.",
      409,
      "PAYMENT_APPLICATION_MISMATCH",
    );
  }
}

module.exports = { assertApprovalPaymentBinding };

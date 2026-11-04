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

/**
 * @param action "capture" (approve) | "cancel" (reject)
 * @returns {{mutate: boolean}} whether the payment command may be sent. Throws 409 when a
 *   mutation would act on a payment not provably bound to this application.
 *
 * Owner policy (P5):
 *   - any payment MUTATION requires a verified binding;
 *   - approve: an intent without a verified binding fails closed (approving would otherwise
 *     process an application whose payment was never taken);
 *   - reject: an application with NO account payment record (account /latest 404) is rejected
 *     without any payment mutation - an unpaid application is never blocked from rejection. A
 *     locally stored intent alone is not a payment record and is not cancelled;
 *   - malformed / inconsistent account records (no applicationId, another application, another
 *     intent) fail closed for both.
 */
function assertApprovalPaymentBinding({ applicationId, paymentIntentId, latestPayment, mode = "INLINE", action = "capture" }) {
  const intent = norm(paymentIntentId);
  if (!intent) return { mutate: false }; // nothing to capture / cancel
  if (mode === "LINK") return { mutate: true };
  if (!latestPayment) {
    if (action === "cancel") return { mutate: false };
    throw new AppError(
      "The payment for this application could not be verified as bound to it. Nothing was charged or released.",
      409,
      "PAYMENT_BINDING_MISSING",
    );
  }
  if (!norm(latestPayment.applicationId)) {
    throw new AppError(
      "The payment record for this application is malformed (no application binding). Nothing was charged or released.",
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
  return { mutate: true };
}

module.exports = { assertApprovalPaymentBinding };

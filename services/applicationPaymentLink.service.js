"use strict";
/**
 * Deferred application payment links - profile-service side
 * (account-service docs/design/IMPLEMENTATION_PLAN.md s.2.1, s.3, s.5.3).
 *
 * profile owns the application and its `personalDetails.payment` state; account-service owns
 * the Stripe Checkout Session, the Payment/PaymentIntent and the price. They talk only through
 * events (outbox here, listeners below). The client never supplies an amount, a price or the
 * payment state.
 *
 * State (s.5.3): NONE -> LINK_REQUESTED -> LINK_ISSUED -> AUTHORISED -> CAPTURED, with
 * LINK_ISSUED -> LINK_EXPIRED, AUTHORISED -> AUTHORISATION_EXPIRING -> AUTHORISATION_EXPIRED,
 * CAPTURED -> PARTIALLY_REFUNDED -> REFUNDED and * -> FAILED | CANCELED. An event applies only
 * for the application's current linkVersion and only along an allowed transition.
 */
const crypto = require("crypto");
const PersonalDetails = require("../models/personal.details.model.js");
const SubscriptionDetails = require("../models/subscription.model.js");
const ProfessionalDetails = require("../models/professional.details.model.js");
const IdempotencyKey = require("../models/idempotencyKey.model.js");
const ProcessedEvent = require("../models/processedEvent.model.js");
const { enqueueOutboxEvent } = require("./outbox.service.js");
const { AppError } = require("../errors/AppError");
const { APPLICATION_STATUS, PAYMENT_TYPE, PREFERRED_EMAIL } = require("../constants/enums.js");

const IDEMPOTENCY_SCOPE = "application-payment-link";
const ACTIVE_LINK = ["LINK_REQUESTED", "LINK_ISSUED"];
const AUTHORISED_OR_LATER = [
  "AUTHORISED",
  "AUTHORISATION_EXPIRING",
  "CAPTURED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
];
// Approval may capture only these (the PaymentIntent is at requires_capture, or already captured).
const APPROVAL_READY = ["AUTHORISED", "AUTHORISATION_EXPIRING", "CAPTURED"];

// Allowed application-payment transitions for account -> profile events.
const ALLOWED_FROM = {
  LINK_ISSUED: ["LINK_REQUESTED"],
  LINK_EXPIRED: ["LINK_ISSUED"],
  AUTHORISED: ["LINK_REQUESTED", "LINK_ISSUED", "LINK_EXPIRED", "FAILED"],
  AUTHORISATION_EXPIRING: ["AUTHORISED"],
  AUTHORISATION_EXPIRED: ["AUTHORISED", "AUTHORISATION_EXPIRING"],
  CAPTURED: ["AUTHORISED", "AUTHORISATION_EXPIRING", "LINK_ISSUED", "LINK_EXPIRED", "FAILED"],
  PARTIALLY_REFUNDED: ["CAPTURED", "PARTIALLY_REFUNDED"],
  REFUNDED: ["CAPTURED", "PARTIALLY_REFUNDED"],
  FAILED: ["LINK_REQUESTED", "LINK_ISSUED"],
  CANCELED: ["LINK_REQUESTED", "LINK_ISSUED", "LINK_EXPIRED", "AUTHORISED", "AUTHORISATION_EXPIRING", "FAILED"],
};

let accountClient = null;
function account() {
  return accountClient || require("./account.service.client.js");
}
/** Test seam. */
function setAccountClient(client) {
  accountClient = client;
}

const linkKey = (tenantId, applicationId, linkVersion) =>
  `link:${tenantId}:${applicationId}:v${linkVersion}`;

function membershipCategoryOf(subscription, professional) {
  const s = subscription?.subscriptionDetails?.membershipCategory;
  if (s != null && s !== "") return s;
  const p = professional?.professionalDetails?.membershipCategory;
  if (p != null && p !== "") return p;
  return null;
}

function effectiveStatus(payment, now = new Date()) {
  if (!payment?.status) return "NONE";
  if (payment.status === "LINK_ISSUED" && payment.expiresAt && new Date(payment.expiresAt) <= now) {
    return "LINK_EXPIRED";
  }
  return payment.status;
}

/** Public view for GET /payment. checkoutUrl only while the link is live. */
function paymentView(personal, now = new Date()) {
  const p = personal?.payment;
  if (!p || !p.mode) {
    return {
      mode: "INLINE",
      status: "NONE",
      reason: null,
      paymentOption: null,
      linkVersion: 0,
      checkoutUrl: null,
      expiresAt: null,
      authorisationExpiresAt: null,
      amount: null,
      currency: null,
      approvalReady: false,
      updatedAt: null,
    };
  }
  const status = effectiveStatus(p, now);
  return {
    mode: p.mode,
    status,
    reason: p.reason || null,
    paymentOption: p.paymentOption || "FULL",
    linkVersion: p.linkVersion || 0,
    checkoutUrl: status === "LINK_ISSUED" ? p.checkoutUrl || null : null,
    expiresAt: p.expiresAt || null,
    authorisationExpiresAt: p.authorisationExpiresAt || null,
    amount: p.amount ?? null,
    currency: p.currency || null,
    approvalReady: APPROVAL_READY.includes(status),
    updatedAt: p.updatedAt || null,
  };
}

function requestHash(applicationId, body) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ applicationId, action: body.action, paymentOption: body.paymentOption || null }))
    .digest("hex");
}

/**
 * Persisted Idempotency-Key handling. Returns {replay: {status, body}} for a completed repeat,
 * throws 422 for a key reused with a different request and 409 while the first is in flight.
 */
async function claimIdempotencyKey(tenantId, key, hash) {
  try {
    await IdempotencyKey.create({ tenantId, scope: IDEMPOTENCY_SCOPE, key, requestHash: hash });
    return { claimed: true };
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }
  const existing = await IdempotencyKey.findOne({ tenantId, scope: IDEMPOTENCY_SCOPE, key }).lean();
  if (!existing) throw AppError.conflict("Idempotency key is being processed, retry", { code: "IDEMPOTENCY_IN_PROGRESS" });
  if (existing.requestHash !== hash) {
    throw new AppError("Idempotency-Key was used with a different request", 422, "IDEMPOTENCY_KEY_REUSED");
  }
  if (existing.state === "DONE") return { replay: existing.response };
  throw new AppError("A request with this Idempotency-Key is still being processed", 409, "IDEMPOTENCY_IN_PROGRESS");
}

async function completeIdempotencyKey(tenantId, key, response) {
  await IdempotencyKey.updateOne(
    { tenantId, scope: IDEMPOTENCY_SCOPE, key },
    { $set: { state: "DONE", response } }
  );
}

async function releaseIdempotencyKey(tenantId, key) {
  await IdempotencyKey.deleteOne({ tenantId, scope: IDEMPOTENCY_SCOPE, key, state: "IN_PROGRESS" });
}

function businessError(status, code, message) {
  return new AppError(message, status, code);
}

function recipientOf(personal) {
  const c = personal?.contactInfo || {};
  const preferWork = c.preferredEmail === PREFERRED_EMAIL.WORK;
  const email = (preferWork ? c.workEmail || c.personalEmail : c.personalEmail || c.workEmail) || null;
  const name = [personal?.personalInfo?.forename, personal?.personalInfo?.surname].filter(Boolean).join(" ") || null;
  return { email, name };
}

async function enqueueEmailRequest(tenantId, personal, sequence) {
  const p = personal.payment;
  const recipient = recipientOf(personal);
  if (!recipient.email) return false;
  const eventKey = `${linkKey(tenantId, personal.applicationId, p.linkVersion)}:email:${sequence}`;
  await enqueueOutboxEvent({
    eventKey,
    tenantId,
    routingKey: "applications.payment-link.email.requested.v1",
    data: {
      applicationId: personal.applicationId,
      linkVersion: p.linkVersion,
      dedupeKey: eventKey,
      recipient,
      checkoutUrl: p.checkoutUrl,
      expiresAt: p.expiresAt,
      amount: p.amount,
      currency: p.currency,
      paymentOption: p.paymentOption || "FULL",
      templateCode: "APPLICATION_PAYMENT_LINK",
    },
  });
  return true;
}

/**
 * POST /api/applications/:applicationId/payment-link
 * @param ctx {tenantId, userId, channel}
 * @param body validated {action, paymentOption}
 * @returns {{status: number, body: object}}
 */
async function requestPaymentLink(ctx, applicationId, body, idempotencyKey, req, { now = new Date() } = {}) {
  const { tenantId, userId } = ctx;
  const hash = requestHash(applicationId, body);
  const claim = await claimIdempotencyKey(tenantId, idempotencyKey, hash);
  if (claim.replay) return claim.replay;
  try {
    const response = await processLinkRequest(ctx, applicationId, body, req, now);
    await completeIdempotencyKey(tenantId, idempotencyKey, response);
    return response;
  } catch (err) {
    if (err instanceof AppError && err.status >= 400 && err.status < 500) {
      // Deterministic business outcome: replay it for the same key.
      await completeIdempotencyKey(tenantId, idempotencyKey, {
        status: err.status,
        // Same shape as middlewares/response.mw.js errorHandler for an AppError.
        body: { success: false, error: { message: err.message, code: err.code, status: err.status } },
      });
    } else {
      await releaseIdempotencyKey(tenantId, idempotencyKey);
    }
    throw err;
  }
}

async function processLinkRequest(ctx, applicationId, body, req, now) {
  const { tenantId, userId, channel } = ctx;
  const personal = await PersonalDetails.findOne({ tenantId, applicationId }).lean();
  if (!personal || personal.meta?.deleted === true) throw AppError.notFound("Application not found");
  if ([APPLICATION_STATUS.PROCESSED, APPLICATION_STATUS.REJECTED].includes(personal.applicationStatus)) {
    throw businessError(409, "APPLICATION_CLOSED", "Application is already processed or rejected");
  }
  const [subscription, professional] = await Promise.all([
    SubscriptionDetails.findOne({ tenantId, applicationId }).lean(),
    ProfessionalDetails.findOne({ tenantId, applicationId }).lean(),
  ]);
  const paymentType = subscription?.subscriptionDetails?.paymentType || null;
  if (paymentType !== PAYMENT_TYPE.CARD_PAYMENT) {
    throw businessError(409, "PAYMENT_METHOD_NOT_SUPPORTED", "Payment links are available for card applications only");
  }
  if (body.action !== "RESEND" && (body.paymentOption || "FULL") !== "FULL") {
    throw businessError(409, "INSTALMENTS_NOT_ALLOWED", "Only full payment links are available");
  }

  const current = personal.payment || {};
  const status = effectiveStatus(current, now);

  if (body.action === "RESEND") {
    if (status !== "LINK_ISSUED") throw businessError(409, "NO_ACTIVE_LINK", "There is no active payment link to resend");
    const updated = await PersonalDetails.findOneAndUpdate(
      { tenantId, applicationId, "payment.linkVersion": current.linkVersion, "payment.status": "LINK_ISSUED" },
      { $inc: { "payment.emailSequence": 1 }, $set: { "payment.updatedAt": new Date() } },
      { new: true }
    ).lean();
    if (!updated) throw businessError(409, "CONCURRENT_UPDATE", "Payment link changed, retry");
    const sent = await enqueueEmailRequest(tenantId, updated, updated.payment.emailSequence);
    if (!sent) throw businessError(409, "NO_RECIPIENT_EMAIL", "Application has no email address");
    return {
      status: 202,
      body: { status: "success", data: { applicationId, linkVersion: current.linkVersion, payment: { status: "LINK_ISSUED" } } },
    };
  }

  if (AUTHORISED_OR_LATER.includes(status)) {
    throw businessError(409, "ALREADY_AUTHORISED", "A payment for this application is already authorised");
  }
  if (body.action === "ISSUE" && ACTIVE_LINK.includes(status)) {
    throw businessError(409, "LINK_ACTIVE", "A payment link is already active; use RESEND or REPLACE");
  }

  // Inline (portal) payments live only in account-service: ask it before issuing.
  try {
    const latest = await account().fetchLatestApplicationPayment(applicationId, tenantId, req);
    const s = latest?.status || latest?.paymentStatus;
    if (["requires_capture", "succeeded", "partially_refunded", "refunded"].includes(s)) {
      throw businessError(409, "ALREADY_AUTHORISED", "A payment for this application is already authorised");
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    // account-service re-checks when it consumes the request; do not block on a lookup outage.
    console.warn("[payment-link] latest payment lookup failed; account-service will re-check", {
      applicationId,
      name: err?.name,
    });
  }

  const previousVersion = current.linkVersion || 0;
  const linkVersion = previousVersion + 1;
  const versionGuard = previousVersion
    ? { "payment.linkVersion": previousVersion }
    : { $or: [{ payment: { $exists: false } }, { payment: null }, { "payment.linkVersion": 0 }] };
  const nextPayment = {
    mode: "LINK",
    status: "LINK_REQUESTED",
    reason: null,
    paymentOption: "FULL",
    linkVersion,
    paymentId: null,
    paymentLinkId: null,
    paymentIntentId: null,
    checkoutUrl: null,
    expiresAt: null,
    authorisationExpiresAt: null,
    amount: null,
    currency: null,
    emailSequence: 0,
    requestedBy: { userId: String(userId), channel: channel || "CRM" },
    requestedAt: new Date(),
    lastEventKey: null,
    updatedAt: new Date(),
  };
  const res = await PersonalDetails.updateOne(
    { tenantId, applicationId, ...versionGuard },
    { $set: { payment: nextPayment } }
  );
  if (!res.modifiedCount) throw businessError(409, "CONCURRENT_UPDATE", "Payment link changed, retry");

  const eventKey = `${linkKey(tenantId, applicationId, linkVersion)}:requested`;
  try {
    await enqueueOutboxEvent({
      eventKey,
      tenantId,
      routingKey: "applications.payment-link.requested.v1",
      data: {
        applicationId,
        linkVersion,
        action: previousVersion ? "REPLACE" : "ISSUE",
        paymentOption: "FULL",
        // Pricing INPUTS from profile's own application record; account computes the amount.
        pricing: {
          membershipCategory: membershipCategoryOf(subscription, professional),
          paymentType,
        },
        requestedBy: { userId: String(userId), userType: "CRM", channel: channel || "CRM" },
      },
    });
  } catch (err) {
    // Roll the state back so the caller can retry with the same key.
    await PersonalDetails.updateOne(
      { tenantId, applicationId, "payment.linkVersion": linkVersion, "payment.status": "LINK_REQUESTED" },
      previousVersion ? { $set: { payment: current } } : { $unset: { payment: "" } }
    );
    throw AppError.serviceUnavailable("Unable to record the payment link request, retry");
  }

  return {
    status: 202,
    body: { status: "success", data: { applicationId, linkVersion, payment: { status: "LINK_REQUESTED" } } },
  };
}

async function getApplicationPayment(tenantId, applicationId, { now = new Date() } = {}) {
  const personal = await PersonalDetails.findOne({ tenantId, applicationId }).select({ payment: 1, applicationId: 1, meta: 1 }).lean();
  if (!personal || personal.meta?.deleted === true) throw AppError.notFound("Application not found");
  return paymentView(personal, now);
}

// ---------- listeners (account -> profile) ----------

async function alreadyProcessed(eventKey) {
  if (!eventKey) return false;
  return Boolean(await ProcessedEvent.exists({ eventKey }));
}
async function markProcessed(eventKey, tenantId, routingKey) {
  if (!eventKey) return;
  try {
    await ProcessedEvent.create({ eventKey, tenantId, routingKey });
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }
}

/** Conditional transition on the current link version. Returns the updated doc or null. */
async function transition(tenantId, applicationId, linkVersion, to, set = {}, eventKey = null) {
  const from = ALLOWED_FROM[to] || [];
  return PersonalDetails.findOneAndUpdate(
    {
      tenantId,
      applicationId,
      "payment.mode": "LINK",
      "payment.linkVersion": linkVersion,
      "payment.status": { $in: from },
    },
    {
      $set: {
        "payment.status": to,
        "payment.updatedAt": new Date(),
        "payment.lastEventKey": eventKey,
        ...Object.fromEntries(Object.entries(set).map(([k, v]) => [`payment.${k}`, v])),
      },
    },
    { new: true }
  ).lean();
}

const STATUS_FROM_PAYMENT = {
  requires_capture: "AUTHORISED",
  succeeded: "CAPTURED",
  authorization_expired: "AUTHORISATION_EXPIRED",
  canceled: "CANCELED",
  failed: "FAILED",
  refunded: "REFUNDED",
  partially_refunded: "PARTIALLY_REFUNDED",
};

/**
 * Handle one account -> profile payment-link event. tenantId is the trusted envelope tenant.
 * Returns {applied, reason}.
 */
async function handlePaymentLinkEvent(routingKey, tenantId, data) {
  const applicationId = String(data?.applicationId || "").trim();
  const linkVersion = Number(data?.linkVersion);
  const eventKey = data?.eventKey || null;
  if (!applicationId || !Number.isInteger(linkVersion) || linkVersion < 1) {
    return { applied: false, reason: "invalid" };
  }
  if (await alreadyProcessed(eventKey)) return { applied: false, reason: "duplicate" };

  let updated = null;
  switch (routingKey) {
    case "payments.payment-link.issued.v1":
      updated = await transition(tenantId, applicationId, linkVersion, "LINK_ISSUED", {
        paymentId: data.paymentId || null,
        paymentLinkId: data.paymentLinkId || null,
        checkoutUrl: data.checkoutUrl || null,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        amount: Number.isInteger(data.amount) ? data.amount : null,
        currency: data.currency || null,
        reason: null,
        emailSequence: 1,
      }, eventKey);
      if (updated) await enqueueEmailRequest(tenantId, updated, 1);
      break;
    case "payments.payment-link.failed.v1":
      updated = await transition(tenantId, applicationId, linkVersion, "FAILED", { reason: data.reason || "UNKNOWN" }, eventKey);
      break;
    case "payments.payment-link.expired.v1":
      updated = await transition(tenantId, applicationId, linkVersion, "LINK_EXPIRED", {}, eventKey);
      break;
    case "payments.application-payment.status-changed.v1": {
      const to = data.applicationStatus || STATUS_FROM_PAYMENT[data.to];
      if (!to) break;
      const set = { paymentId: data.paymentId || null };
      if (data.paymentIntentId) set.paymentIntentId = data.paymentIntentId;
      if (to === "AUTHORISED") {
        set.authorisationExpiresAt = data.capturableUntil ? new Date(data.capturableUntil) : null;
        set.reason = null;
      }
      if (to === "FAILED") set.reason = "PAYMENT_DECLINED";
      if (to === "CANCELED" && /duplicate/.test(eventKey || "")) set.reason = "DUPLICATE_AUTHORISATION";
      updated = await transition(tenantId, applicationId, linkVersion, to, set, eventKey);
      break;
    }
    case "payments.application-payment.authorisation-expiring.v1":
      updated = await transition(tenantId, applicationId, linkVersion, "AUTHORISATION_EXPIRING", {
        authorisationExpiresAt: data.capturableUntil ? new Date(data.capturableUntil) : null,
      }, eventKey);
      break;
    default:
      return { applied: false, reason: "unknown_routing_key" };
  }
  await markProcessed(eventKey, tenantId, routingKey);
  return { applied: Boolean(updated), reason: updated ? "transition" : "not_applicable" };
}

// ---------- approval ----------

/**
 * PaymentIntent for approval. LINK mode: the link's own PaymentIntent (from the payment
 * record via the status-changed events), and only once AUTHORISED - a link that merely exists
 * never makes an application approvable. INLINE mode: the existing resolution, unchanged.
 * The caller captures with the existing capturePaymentIntent().
 * @returns {Promise<{paymentIntentId: string|null, latestPayment: object|null, mode: string}>}
 */
async function resolveApprovalPaymentIntent({ personal, applicationId, tenantId, req, inlineResolver }) {
  const p = personal?.payment;
  if (p?.mode === "LINK") {
    const status = effectiveStatus(p);
    if (!APPROVAL_READY.includes(status) || !p.paymentIntentId) {
      throw new AppError(
        `Payment link is not authorised (status ${status}). Application was not approved.`,
        409,
        status === "AUTHORISATION_EXPIRED" ? "PAYMENT_AUTHORISATION_EXPIRED" : "PAYMENT_NOT_AUTHORISED"
      );
    }
    return { paymentIntentId: p.paymentIntentId, latestPayment: null, mode: "LINK" };
  }
  const inline = await inlineResolver({ applicationId, tenantId, req });
  return { ...inline, mode: "INLINE" };
}

module.exports = {
  requestPaymentLink,
  getApplicationPayment,
  handlePaymentLinkEvent,
  resolveApprovalPaymentIntent,
  paymentView,
  setAccountClient,
  APPROVAL_READY,
};

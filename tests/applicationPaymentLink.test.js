"use strict";
/**
 * PL-4 profile-service payment links: POST /applications/:id/payment-link and
 * GET /applications/:id/payment, persisted idempotency, outbox, listeners with processedEvents
 * dedupe and monotonic state, approval resolution (LINK vs INLINE), tenant isolation.
 * Uses a throwaway mongod from PATH (skips when unavailable).
 */
jest.mock("uuid", () => ({ v4: () => require("crypto").randomUUID() }));
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn, spawnSync } = require("child_process");
const mongoose = require("mongoose");

const PersonalDetails = require("../models/personal.details.model.js");
const SubscriptionDetails = require("../models/subscription.model.js");
const ProfessionalDetails = require("../models/professional.details.model.js");
const OutboxEvent = require("../models/outboxEvent.model.js");
const ProcessedEvent = require("../models/processedEvent.model.js");
const IdempotencyKey = require("../models/idempotencyKey.model.js");
const service = require("../services/applicationPaymentLink.service.js");
const outbox = require("../services/outbox.service.js");
const controller = require("../controllers/applicationPaymentLink.controller.js");
const joischemas = require("../validation/index.js");

const A = "tenant-a";
const B = "tenant-b";
const hasMongod = spawnSync("mongod", ["--version"]).status === 0;
const d = hasMongod ? describe : describe.skip;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

let mongod;
const latestByApp = {};
service.setAccountClient({
  fetchLatestApplicationPayment: async (applicationId) => latestByApp[applicationId] || null,
});
const staff = { tenantId: A, userId: "staff-1", channel: "MEMBERSHUB" };

async function seedApplication(tenantId, applicationId, { paymentType = "Credit Card", category = "General Nurse", status = "submitted", email = "applicant@example.test" } = {}) {
  // Raw inserts: intake validation is not under test here.
  await PersonalDetails.collection.insertOne({
    tenantId,
    applicationId,
    applicationStatus: status,
    personalInfo: { forename: "Test", surname: "Applicant" },
    contactInfo: { personalEmail: email, preferredEmail: "personal" },
    meta: { userType: "CRM", deleted: false, isActive: true },
  });
  await SubscriptionDetails.collection.insertOne({
    tenantId,
    applicationId,
    subscriptionDetails: { paymentType, membershipCategory: category },
  });
}

const issue = (applicationId, key, body = { action: "ISSUE", paymentOption: "FULL" }, ctx = staff) =>
  service.requestPaymentLink(ctx, applicationId, body, key, { headers: {} });

async function expectCode(promise, status, code) {
  await expect(promise).rejects.toMatchObject({ status, code });
}

function issuedEvent(applicationId, linkVersion = 1, extra = {}) {
  return {
    applicationId,
    linkVersion,
    paymentLinkId: "pl-1",
    paymentId: "pay-1",
    checkoutSessionId: "cs_test_1",
    checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_1",
    expiresAt: new Date(Date.now() + 23 * 3600 * 1000).toISOString(),
    amount: 29900,
    currency: "eur",
    eventKey: `link:${A}:${applicationId}:v${linkVersion}:issued`,
    ...extra,
  };
}
const statusEvent = (applicationId, to, applicationStatus, linkVersion = 1, extra = {}) => ({
  applicationId,
  linkVersion,
  paymentId: "pay-1",
  paymentIntentId: "pi_link_1",
  to,
  applicationStatus,
  amount: 29900,
  currency: "eur",
  eventKey: `pay:pay-1:${to}`,
  ...extra,
});

d("application payment links (profile-service)", () => {
  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-paylink-"));
    const port = await freePort();
    mongod = spawn("mongod", ["--dbpath", dir, "--port", String(port), "--bind_ip", "127.0.0.1", "--quiet"], { stdio: "ignore" });
    const uri = `mongodb://127.0.0.1:${port}/profile_payment_link_test`;
    for (let i = 0; i < 50; i += 1) {
      try {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 500, autoIndex: false });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    await mongoose.connection.db.dropDatabase();
    // personalDetails declares applicationId twice (unique + plain index, pre-existing), which
    // syncIndexes rejects; only this feature's collections need their indexes here.
    for (const M of [OutboxEvent, ProcessedEvent, IdempotencyKey]) {
      await M.syncIndexes();
    }
    await seedApplication(A, "app-1");
    await seedApplication(A, "app-dd", { paymentType: "Direct Debit" });
    await seedApplication(A, "app-closed", { status: "processed" });
    await seedApplication(A, "app-inline");
    await seedApplication(A, "app-flow");
    await seedApplication(A, "app-replace");
    await seedApplication(B, "app-b1");
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect().catch(() => {});
    if (mongod) mongod.kill("SIGTERM");
  });

  test("ISSUE: 202 LINK_REQUESTED; requested event carries pricing INPUTS only, from profile's record", async () => {
    const r = await issue("app-1", "key-1");
    expect(r.status).toBe(202);
    expect(r.body.data).toEqual({ applicationId: "app-1", linkVersion: 1, payment: { status: "LINK_REQUESTED" } });
    const doc = await PersonalDetails.findOne({ tenantId: A, applicationId: "app-1" }).lean();
    expect(doc.payment).toMatchObject({ mode: "LINK", status: "LINK_REQUESTED", linkVersion: 1, paymentOption: "FULL" });
    expect((await OutboxEvent.findOne({ eventKey: `link:${A}:app-1:v1:requested` }).lean()).data.paymentOption).toBe("FULL");
    const out = await OutboxEvent.findOne({ eventKey: `link:${A}:app-1:v1:requested` }).lean();
    expect(out.tenantId).toBe(A);
    expect(out.routingKey).toBe("applications.payment-link.requested.v1");
    expect(out.data.pricing).toEqual({ membershipCategory: "General Nurse", paymentType: "Credit Card" });
    expect(out.data).not.toHaveProperty("amount");
    expect(out.data.requestedBy).toMatchObject({ userId: "staff-1", channel: "MEMBERSHUB" });
  });

  test("duplicate client request: same key + body replays; same key + different body -> 422", async () => {
    const again = await issue("app-1", "key-1");
    expect(again.status).toBe(202);
    expect(await OutboxEvent.countDocuments({ eventKey: /:app-1:/ })).toBe(1);
    await expectCode(issue("app-1", "key-1", { action: "REPLACE", paymentOption: "FULL" }), 422, "IDEMPOTENCY_KEY_REUSED");
  });

  test("ISSUE while a link is active -> 409 LINK_ACTIVE; RESEND with none issued -> NO_ACTIVE_LINK", async () => {
    await expectCode(issue("app-1", "key-2"), 409, "LINK_ACTIVE");
    await expectCode(issue("app-1", "key-3", { action: "RESEND" }), 409, "NO_ACTIVE_LINK");
    // business errors are replayed (same status and code) for the same key
    const replay = await issue("app-1", "key-2");
    expect(replay.status).toBe(409);
    expect(replay.body).toMatchObject({ success: false, error: { code: "LINK_ACTIVE", status: 409 } });
  });

  test("non-card application -> three-month link (FIRST_INSTALMENT), never refused for being non-card", async () => {
    const r = await issue("app-dd", "k-dd", { action: "ISSUE" });
    expect(r.status).toBe(202);
    const doc = await PersonalDetails.findOne({ tenantId: A, applicationId: "app-dd" }).lean();
    expect(doc.payment).toMatchObject({ status: "LINK_REQUESTED", paymentOption: "FIRST_INSTALMENT" });
    const out = await OutboxEvent.findOne({ eventKey: `link:${A}:app-dd:v1:requested` }).lean();
    expect(out.data.paymentOption).toBe("FIRST_INSTALMENT");
    expect(out.data.pricing).toEqual({ membershipCategory: "General Nurse", paymentType: "Direct Debit" });
    expect(out.data).not.toHaveProperty("amount");
    // issued: price and basis come from account-service and are shown as-is
    await service.handlePaymentLinkEvent("payments.payment-link.issued.v1", A, issuedEvent("app-dd", 1, {
      amount: 7475, paymentOption: "FIRST_INSTALMENT", pricingBasis: { basis: "THREE_MONTHS", annualFee: 29900 }, eventKey: "dd-issued",
    }));
    const view = await service.getApplicationPayment(A, "app-dd");
    expect(view).toMatchObject({ amount: 7475, paymentOption: "FIRST_INSTALMENT", pricingBasis: "THREE_MONTHS" });
  });

  test("client paymentOption that disagrees with the payment type -> 409 PAYMENT_OPTION_MISMATCH", async () => {
    await seedApplication(A, "app-so", { paymentType: "Standing Order" });
    await expectCode(issue("app-so", "k-so", { action: "ISSUE", paymentOption: "FULL" }), 409, "PAYMENT_OPTION_MISMATCH");
    await expectCode(issue("app-flow", "k-fi", { action: "ISSUE", paymentOption: "FIRST_INSTALMENT" }), 409, "PAYMENT_OPTION_MISMATCH");
    await seedApplication(A, "app-unknown-type", { paymentType: "Bitcoin" });
    await expectCode(issue("app-unknown-type", "k-ut"), 409, "PAYMENT_METHOD_NOT_SUPPORTED");
  });

  test("closed application, inline authorised payment -> 409", async () => {
    await expectCode(issue("app-closed", "k-cl"), 409, "APPLICATION_CLOSED");
    latestByApp["app-inline"] = { paymentIntentId: "pi_inline", status: "requires_capture" };
    await expectCode(issue("app-inline", "k-in"), 409, "ALREADY_AUTHORISED");
    expect(await OutboxEvent.countDocuments({ "data.applicationId": { $in: ["app-closed", "app-inline", "app-so", "app-unknown-type"] } })).toBe(0);
  });

  test("tenant isolation: another tenant's application reads as not found (POST and GET)", async () => {
    await expectCode(issue("app-b1", "k-x"), 404, "NOT_FOUND");
    await expectCode(service.getApplicationPayment(A, "app-b1"), 404, "NOT_FOUND");
    await expectCode(issue("app-1", "k-y", undefined, { ...staff, tenantId: B }), 404, "NOT_FOUND");
    const b = await PersonalDetails.findOne({ tenantId: B, applicationId: "app-b1" }).lean();
    expect(b.payment).toBeUndefined();
  });

  test("listener: issued -> LINK_ISSUED + email request; duplicate delivery is a no-op", async () => {
    const r1 = await service.handlePaymentLinkEvent("payments.payment-link.issued.v1", A, issuedEvent("app-1"));
    expect(r1).toEqual({ applied: true, reason: "transition" });
    const r2 = await service.handlePaymentLinkEvent("payments.payment-link.issued.v1", A, issuedEvent("app-1"));
    expect(r2.reason).toBe("duplicate");
    const doc = await PersonalDetails.findOne({ tenantId: A, applicationId: "app-1" }).lean();
    expect(doc.payment).toMatchObject({ status: "LINK_ISSUED", amount: 29900, currency: "eur", paymentId: "pay-1" });
    const email = await OutboxEvent.findOne({ eventKey: `link:${A}:app-1:v1:email:1` }).lean();
    expect(email.routingKey).toBe("applications.payment-link.email.requested.v1");
    expect(email.data.recipient).toEqual({ email: "applicant@example.test", name: "Test Applicant" });
    expect(email.data.templateCode).toBe("APPLICATION_PAYMENT_LINK");
  });

  test("listener: issued redelivered after the email outbox write failed still queues the email once", async () => {
    await seedApplication(A, "app-em");
    await issue("app-em", "k-em");
    const spy = jest.spyOn(OutboxEvent, "updateOne").mockRejectedValueOnce(new Error("mongo blip"));
    try {
      await expect(
        service.handlePaymentLinkEvent("payments.payment-link.issued.v1", A, issuedEvent("app-em"))
      ).rejects.toThrow("mongo blip");
    } finally {
      spy.mockRestore();
    }
    const mid = await PersonalDetails.findOne({ tenantId: A, applicationId: "app-em" }).lean();
    expect(mid.payment.status).toBe("LINK_ISSUED");
    expect(await OutboxEvent.countDocuments({ eventKey: `link:${A}:app-em:v1:email:1` })).toBe(0);

    // consumer retry
    const r = await service.handlePaymentLinkEvent("payments.payment-link.issued.v1", A, issuedEvent("app-em"));
    expect(r.reason).toBe("not_applicable");
    expect(await OutboxEvent.countDocuments({ eventKey: `link:${A}:app-em:v1:email:1` })).toBe(1);
    // and once processed, a further delivery is a plain duplicate
    const r3 = await service.handlePaymentLinkEvent("payments.payment-link.issued.v1", A, issuedEvent("app-em"));
    expect(r3.reason).toBe("duplicate");
    expect(await OutboxEvent.countDocuments({ eventKey: `link:${A}:app-em:v1:email:1` })).toBe(1);
  });

  test("listener: event for the right application but another tenant is not applied", async () => {
    const r = await service.handlePaymentLinkEvent(
      "payments.application-payment.status-changed.v1",
      B,
      statusEvent("app-1", "requires_capture", "AUTHORISED", 1, { eventKey: "pay:forged:1" }),
    );
    expect(r.applied).toBe(false);
    expect((await PersonalDetails.findOne({ tenantId: A, applicationId: "app-1" }).lean()).payment.status).toBe("LINK_ISSUED");
  });

  test("GET /payment: checkoutUrl only while LINK_ISSUED; expiry is derived; not approval-ready", async () => {
    const view = await service.getApplicationPayment(A, "app-1");
    expect(view).toMatchObject({ mode: "LINK", status: "LINK_ISSUED", approvalReady: false, amount: 29900 });
    expect(view.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const later = await service.getApplicationPayment(A, "app-1", { now: new Date(Date.now() + 25 * 3600 * 1000) });
    expect(later.status).toBe("LINK_EXPIRED");
    expect(later.checkoutUrl).toBeNull();
    const none = await service.getApplicationPayment(A, "app-flow");
    expect(none).toMatchObject({ mode: "INLINE", status: "NONE", approvalReady: false });
  });

  test("RESEND re-requests the email with the next sequence", async () => {
    const r = await issue("app-1", "key-resend", { action: "RESEND" });
    expect(r.status).toBe(202);
    expect(await OutboxEvent.countDocuments({ eventKey: `link:${A}:app-1:v1:email:2` })).toBe(1);
  });

  test("monotonic: AUTHORISED, then late/stale events cannot move it back; CAPTURED", async () => {
    await service.handlePaymentLinkEvent("payments.application-payment.status-changed.v1", A, statusEvent("app-1", "requires_capture", "AUTHORISED", 1, { capturableUntil: new Date(Date.now() + 6 * 86400000).toISOString() }));
    let doc = await PersonalDetails.findOne({ tenantId: A, applicationId: "app-1" }).lean();
    expect(doc.payment).toMatchObject({ status: "AUTHORISED", paymentIntentId: "pi_link_1" });
    expect(doc.payment.authorisationExpiresAt).toBeTruthy();
    // a re-armed issued event (new eventKey) cannot regress AUTHORISED
    await service.handlePaymentLinkEvent("payments.payment-link.issued.v1", A, issuedEvent("app-1", 1, { eventKey: "issued-redelivery-2" }));
    await service.handlePaymentLinkEvent("payments.payment-link.expired.v1", A, { applicationId: "app-1", linkVersion: 1, eventKey: "late-expired" });
    await service.handlePaymentLinkEvent("payments.application-payment.status-changed.v1", A, statusEvent("app-1", "failed", "FAILED", 1, { eventKey: "late-failed" }));
    doc = await PersonalDetails.findOne({ tenantId: A, applicationId: "app-1" }).lean();
    expect(doc.payment.status).toBe("AUTHORISED");
    // approval-ready now
    expect((await service.getApplicationPayment(A, "app-1")).approvalReady).toBe(true);
    // REPLACE refused after authorisation
    await expectCode(issue("app-1", "key-repl-after-auth", { action: "REPLACE", paymentOption: "FULL" }), 409, "ALREADY_AUTHORISED");
    await service.handlePaymentLinkEvent("payments.application-payment.status-changed.v1", A, statusEvent("app-1", "succeeded", "CAPTURED"));
    doc = await PersonalDetails.findOne({ tenantId: A, applicationId: "app-1" }).lean();
    expect(doc.payment.status).toBe("CAPTURED");
    await service.handlePaymentLinkEvent("payments.application-payment.status-changed.v1", A, statusEvent("app-1", "requires_capture", "AUTHORISED", 1, { eventKey: "late-auth" }));
    expect((await PersonalDetails.findOne({ tenantId: A, applicationId: "app-1" }).lean()).payment.status).toBe("CAPTURED");
  });

  test("REPLACE before authorisation: new version; events for the old version are ignored", async () => {
    await issue("app-replace", "r-1");
    await service.handlePaymentLinkEvent("payments.payment-link.issued.v1", A, issuedEvent("app-replace", 1, { eventKey: "rep-v1-issued" }));
    const r = await issue("app-replace", "r-2", { action: "REPLACE", paymentOption: "FULL" });
    expect(r.body.data.linkVersion).toBe(2);
    const out = await OutboxEvent.findOne({ eventKey: `link:${A}:app-replace:v2:requested` }).lean();
    expect(out.data.action).toBe("REPLACE");
    // the old link's payment authorising late does not touch v2
    await service.handlePaymentLinkEvent("payments.application-payment.status-changed.v1", A, statusEvent("app-replace", "requires_capture", "AUTHORISED", 1, { eventKey: "rep-v1-auth" }));
    const doc = await PersonalDetails.findOne({ tenantId: A, applicationId: "app-replace" }).lean();
    expect(doc.payment).toMatchObject({ linkVersion: 2, status: "LINK_REQUESTED" });
    // failed v2 (e.g. account-service re-check) is recorded with its reason and allows another REPLACE
    await service.handlePaymentLinkEvent("payments.payment-link.failed.v1", A, { applicationId: "app-replace", linkVersion: 2, reason: "ALREADY_AUTHORISED", eventKey: "rep-v2-failed" });
    expect((await service.getApplicationPayment(A, "app-replace")).reason).toBe("ALREADY_AUTHORISED");
  });

  test("approval resolution: LINK needs AUTHORISED; INLINE keeps the existing resolver", async () => {
    const notReady = { payment: { mode: "LINK", status: "LINK_ISSUED", linkVersion: 1, expiresAt: new Date(Date.now() + 3600000) } };
    await expect(
      service.resolveApprovalPaymentIntent({ personal: notReady, applicationId: "x", tenantId: A, inlineResolver: jest.fn() }),
    ).rejects.toMatchObject({ status: 409, code: "PAYMENT_NOT_AUTHORISED" });
    const expired = { payment: { mode: "LINK", status: "AUTHORISATION_EXPIRED", linkVersion: 1, paymentIntentId: "pi_x" } };
    await expect(
      service.resolveApprovalPaymentIntent({ personal: expired, applicationId: "x", tenantId: A, inlineResolver: jest.fn() }),
    ).rejects.toMatchObject({ code: "PAYMENT_AUTHORISATION_EXPIRED" });
    const inlineResolver = jest.fn();
    const ready = { payment: { mode: "LINK", status: "AUTHORISED", linkVersion: 1, paymentIntentId: "pi_ready" } };
    const r = await service.resolveApprovalPaymentIntent({ personal: ready, applicationId: "x", tenantId: A, inlineResolver });
    expect(r).toEqual({ paymentIntentId: "pi_ready", latestPayment: null, mode: "LINK" });
    expect(inlineResolver).not.toHaveBeenCalled();
    const inline = await service.resolveApprovalPaymentIntent({
      personal: { applicationId: "y" },
      applicationId: "y",
      tenantId: A,
      inlineResolver: async () => ({ paymentIntentId: "pi_inline", latestPayment: { attemptNumber: 2 } }),
    });
    expect(inline).toEqual({ paymentIntentId: "pi_inline", latestPayment: { attemptNumber: 2 }, mode: "INLINE" });
  });

  test("both approval paths use the shared resolver (kept in sync)", () => {
    for (const f of ["profileApproval.controller.js", "bulkApproval.controller.js"]) {
      const src = fs.readFileSync(path.join(__dirname, "..", "controllers", f), "utf8");
      expect(src).toMatch(/resolveApprovalPaymentIntent\(\{\s*personal:/);
      expect(src).toMatch(/capturePaymentIntent\(/);
    }
  });

  test("Joi create/update schemas reject a client-supplied payment sub-document", async () => {
    await expect(joischemas.personal_details_create.validateAsync({ payment: { status: "AUTHORISED" } })).rejects.toThrow(/payment/);
    await expect(joischemas.personal_details_update.validateAsync({ payment: { status: "CAPTURED" } })).rejects.toThrow(/payment/);
  });

  test("controller: body amount rejected, Idempotency-Key required, staff only, tenant from context", async () => {
    const run = async (req) => {
      let err = null;
      const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, success(b) { this.body = b; return this; } };
      await controller.requestPaymentLink(req, res, (e) => { err = e; });
      return { err, res };
    };
    const base = () => ({
      tenantId: A,
      ctx: { tenantId: A, userId: "staff-1" },
      user: { userType: "CRM" },
      params: { applicationId: "app-flow" },
      headers: { "idempotency-key": "ctl-1" },
      body: { action: "ISSUE", paymentOption: "FULL" },
    });
    let r = await run({ ...base(), body: { action: "ISSUE", paymentOption: "FULL", amount: 1 } });
    expect(r.err).toMatchObject({ status: 400 });
    r = await run({ ...base(), body: { action: "ISSUE", paymentOption: "FULL", tenantId: B } });
    expect(r.err).toMatchObject({ status: 400 });
    r = await run({ ...base(), headers: {} });
    expect(r.err).toMatchObject({ status: 400 });
    r = await run({ ...base(), user: { userType: "PORTAL" } });
    expect(r.err).toMatchObject({ status: 403 });
    r = await run({ ...base(), tenantId: undefined, ctx: { userId: "staff-1" } });
    expect(r.err).toBeTruthy();
    r = await run(base());
    expect(r.err).toBeNull();
    expect(r.res.code).toBe(202);
  });

  test("outbox relay publishes requested events with the tenant and eventKey", async () => {
    const sent = [];
    outbox.setOutboxPublisher(async (routingKey, data, meta) => {
      sent.push({ routingKey, data, meta });
      return true;
    });
    const r = await outbox.relayOutboxOnce();
    expect(r.failed).toBe(0);
    const req = sent.find((s) => s.data.eventKey === `link:${A}:app-flow:v1:requested`);
    expect(req.routingKey).toBe("applications.payment-link.requested.v1");
    expect(req.meta.tenantId).toBe(A);
    outbox.setOutboxPublisher(null);
  });
});

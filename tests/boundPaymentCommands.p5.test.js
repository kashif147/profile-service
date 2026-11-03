"use strict";
/**
 * P5 bound payment commands, caller side (S2) - profile-service application capture/cancel.
 *
 * ACCOUNT_PAYMENT_COMMAND_MODE=bound: capture/cancel go to account-service as internal-only bound
 * commands (never authorization / x-jwt-verified / x-auth-source / x-user-*), naming the
 * application, the transition, the reason and the actor (audit only) - and only AFTER a committed
 * approve/reject decision claim exists on the application. 409/503 from account leaves the
 * application undecided and the claim released; once money moved the claim stays and the opposite
 * decision is refused. Legacy mode (default) keeps today's request.
 * Real controllers + real account client; in-memory models; axios stubbed.
 */
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.LOG_ROOT = process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-boundpay-"));
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const mm = () => require("./helpers/memoryModel");
jest.mock("../models/personal.details.model.js", () => mm().createMemoryModel("PersonalDetails"));
jest.mock("../models/professional.details.model.js", () => mm().createMemoryModel("ProfessionalDetails"));
jest.mock("../models/subscription.model.js", () => mm().createMemoryModel("SubscriptionDetails"));
jest.mock("../models/profile.model.js", () => mm().createMemoryModel("Profile"));
jest.mock("../models/reviewOverlay.model.js", () => mm().createMemoryModel("ReviewOverlay"));
jest.mock("../models/user.model.js", () => mm().createMemoryModel("User"));
jest.mock("../services/tenant.service.client.js", () => ({
  fetchTenantContext: jest.fn(async () => ({ organisationProfile: {}, tenantName: "T" })),
  formatOrgAddress: jest.fn(),
  formatBankAddress: jest.fn(),
  resolveTenantTradingName: jest.fn(() => "T"),
}));
jest.mock("../services/subscription.service.client.js", () => ({
  fetchCurrentSubscriptionByProfileId: jest.fn(async () => null),
}));
jest.mock("../rabbitMQ/publishers/application.approval.publisher.js", () => ({
  publishApplicationApproved: jest.fn(async () => {}),
  publishApplicationRejected: jest.fn(async () => {}),
  publishSubscriptionUpsertRequested: jest.fn(async () => {}),
}));
jest.mock("../services/publishPostApprovalEvents.js", () => ({
  publishPostApprovalEvents: jest.fn(async () => {}),
}));
jest.mock("../services/duplicate.review.audit.publisher.js", () => ({
  publishDuplicateReviewDecidedAudit: jest.fn(async () => {}),
  publishDuplicateDetectionRunAudit: jest.fn(async () => {}),
  summarizeMergeFieldChoices: jest.fn(),
}));
jest.mock("../services/profile.duplicate.audit.publisher.js", () => ({
  publishProfileDuplicateDetectionRunAudit: jest.fn(async () => {}),
  publishProfileDuplicateMergedAudit: jest.fn(async () => {}),
  serializeProfileForAudit: jest.fn(),
}));
jest.mock("../helpers/workLocationPayment.helper.js", () => ({
  assertSalaryDeductionAllowedForWorkLocation: jest.fn(async () => {}),
}));
jest.mock("../helpers/membership.number.generator.js", () => ({
  generateMembershipNumber: jest.fn(async () => "B100001"),
  getCurrentYearAlphabet: jest.fn(() => "B"),
}));
jest.mock("@projectShell/rabbitmq-middleware", () => ({
  publisher: { publish: jest.fn(async () => {}) },
}));

const axios = require("axios");
const mongoose = require("mongoose");
const { fakeSession, mockRes } = require("./helpers/memoryModel");
const PersonalDetails = require("../models/personal.details.model.js");
const ProfessionalDetails = require("../models/professional.details.model.js");
const SubscriptionDetails = require("../models/subscription.model.js");
const Profile = require("../models/profile.model.js");
const ReviewOverlay = require("../models/reviewOverlay.model.js");
const User = require("../models/user.model.js");
const accountClient = require("../services/account.service.client.js");
// Lazy so the old-code comparison run can load this file (the module is new in this PR).
const decision = {
  claimPaymentDecision: (...a) => require("../services/applicationPaymentDecision.service.js").claimPaymentDecision(...a),
  releasePaymentDecision: (...a) => require("../services/applicationPaymentDecision.service.js").releasePaymentDecision(...a),
};
const applicationController = require("../controllers/application.controller");
const profileApproval = require("../controllers/profileApproval.controller");
const { bulkApproveApplications } = require("../controllers/bulkApproval.controller");

const T = "a1b2c3d4e5f6a7b8c9d0e1f2";
const APP = "app-bound-1";
const APP2 = "app-bound-2";
const ACTOR = "c00000000000000000000001";
const PAYMENT_ID = "d00000000000000000000001";
const IDENTITY_KEYS = ["authorization", "x-jwt-verified", "x-auth-source", "x-user-id", "x-user-email", "x-user-type", "x-user-roles", "x-user-permissions"];

const inboundHeaders = {
  authorization: "Bearer sentinel-not-forwarded",
  "x-jwt-verified": "true",
  "x-auth-source": "gateway",
  "x-user-id": ACTOR,
  "x-user-type": "CRM",
  "x-user-roles": "MO",
  "x-user-permissions": "application:write",
  "idempotency-key": "caller-chosen-key",
  "x-correlation-id": "corr-p1",
};

const crmReq = (extra = {}) => ({
  tenantId: T,
  ctx: { tenantId: T },
  user: { id: ACTOR, userType: "CRM", tenantId: T },
  userId: ACTOR,
  headers: { ...inboundHeaders },
  params: {},
  query: {},
  body: {},
  ...extra,
});

async function invoke(fn, req) {
  const res = mockRes();
  let nextErr;
  await fn(req, res, (err) => {
    nextErr = err;
  });
  return { res, err: nextErr };
}

function personal(appId, extra = {}) {
  return {
    applicationId: appId,
    tenantId: T,
    applicationStatus: "submitted",
    personalInfo: { forename: "Pat", surname: "Bound", dateOfBirth: null },
    contactInfo: { personalEmail: `${appId}@example.com` },
    meta: { isActive: true, userType: "PORTAL" },
    duplicateReview: { status: "NO_MATCH", matchSummary: [] },
    ...extra,
  };
}

const app = (id = APP) => PersonalDetails.all().find((p) => p.applicationId === id);
function expectInternalOnly(headers) {
  for (const k of IDENTITY_KEYS) expect(headers).not.toHaveProperty(k);
  expect(headers["x-internal-request"]).toBe("true");
  expect(headers["x-tenant-id"]).toBe(T);
  expect(JSON.stringify(headers)).not.toContain("sentinel-not-forwarded");
  expect(JSON.stringify(headers)).not.toContain("caller-chosen-key");
}
function refused(status, code = "TRANSITION_NOT_ALLOWED") {
  return { status, data: { success: false, error: { message: "refused", code } } };
}

let post;
let get;
const saved = {};
beforeEach(() => {
  for (const M of [PersonalDetails, ProfessionalDetails, SubscriptionDetails, Profile, ReviewOverlay, User]) M.reset();
  jest.clearAllMocks();
  jest.spyOn(mongoose, "startSession").mockImplementation(async () => fakeSession());
  for (const k of ["ACCOUNT_PAYMENT_COMMAND_MODE", "ACCOUNT_SERVICE_URL"]) saved[k] = process.env[k];
  process.env.ACCOUNT_PAYMENT_COMMAND_MODE = "bound";
  process.env.ACCOUNT_SERVICE_URL = "http://account-service:4000";
  PersonalDetails.seed([personal(APP), personal(APP2)]);
  ProfessionalDetails.seed([{ applicationId: APP, tenantId: T, professionalDetails: { grade: "Staff Nurse" } }]);
  SubscriptionDetails.seed([
    { applicationId: APP, tenantId: T, subscriptionDetails: { membershipCategory: "general" }, paymentDetails: { paymentIntentId: "pi_app" } },
    { applicationId: APP2, tenantId: T, subscriptionDetails: { membershipCategory: "general" }, paymentDetails: { paymentIntentId: "pi_app2" } },
  ]);
  post = jest.spyOn(axios, "post");
  get = jest.spyOn(axios, "get").mockImplementation(async (url) => {
    const id = decodeURIComponent(url.split("/applications/")[1].split("/")[0]);
    return { status: 200, data: { data: { paymentIntentId: id === APP ? "pi_app" : "pi_app2", id: PAYMENT_ID, attemptNumber: 1 } } };
  });
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  jest.restoreAllMocks();
});

describe("client: bound command", () => {
  const command = { applicationId: APP, actorUserId: ACTOR, paymentId: PAYMENT_ID };

  test("capture: internal-only headers, envelope, deterministic key (caller key never used)", async () => {
    post.mockResolvedValue({ status: 200, data: { data: { captured: true } } });
    const out = await accountClient.capturePaymentIntent("pi_app", T, { headers: inboundHeaders }, command);
    expect(out.status).toBe("succeeded");
    const [url, body, cfg] = post.mock.calls[0];
    expect(url).toBe("http://account-service:4000/api/payments/intents/pi_app/capture");
    expectInternalOnly(cfg.headers);
    expect(cfg.headers["Idempotency-Key"]).toBe(`profile-service:capture:${APP}:${PAYMENT_ID}`);
    expect(cfg.headers["x-correlation-id"]).toBe("corr-p1");
    expect(body).toEqual({
      binding: { domain: "application", applicationId: APP, purpose: "applicationFee", paymentId: PAYMENT_ID },
      transition: "capture",
      reason: "approve",
      actorUserId: ACTOR,
    });
  });

  test("cancel: reason reject; canceled -> status canceled", async () => {
    post.mockResolvedValue({ status: 200, data: { data: { alreadyCanceled: true } } });
    const out = await accountClient.cancelPaymentIntent("pi_app", T, { headers: inboundHeaders }, command);
    expect(out.status).toBe("canceled");
    const [, body, cfg] = post.mock.calls[0];
    expectInternalOnly(cfg.headers);
    expect(body).toMatchObject({ transition: "cancel", reason: "reject", binding: { applicationId: APP } });
  });

  test.each([
    ["gateway URL", () => { process.env.ACCOUNT_SERVICE_URL = "https://gw.example.com/account-service"; }, {}, 503, "ACCOUNT_INTERNAL_URL_REQUIRED"],
    ["non-ObjectId tenant", () => {}, { tenant: "tenant-x" }, 400, "TENANT_REQUIRED"],
    ["missing actor", () => {}, { command: { ...command, actorUserId: null } }, 400, "ACTOR_REQUIRED"],
    ["missing application", () => {}, { command: { ...command, applicationId: null } }, 400, "PAYMENT_BINDING_REQUIRED"],
  ])("refuses before calling: %s", async (_n, setup, over, status, code) => {
    setup();
    await expect(
      accountClient.capturePaymentIntent("pi_app", over.tenant || T, { headers: inboundHeaders }, over.command || command),
    ).rejects.toMatchObject({ status, code });
    expect(post).not.toHaveBeenCalled();
  });

  test("account 409 -> 409 with account's code; network failure -> 503", async () => {
    post.mockResolvedValueOnce(refused(409, "PAYMENT_BINDING_MISMATCH"));
    await expect(accountClient.capturePaymentIntent("pi_app", T, null, command)).rejects.toMatchObject({ status: 409, code: "PAYMENT_BINDING_MISMATCH" });
    post.mockRejectedValueOnce(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
    await expect(accountClient.capturePaymentIntent("pi_app", T, null, command)).rejects.toMatchObject({ status: 503, code: "ACCOUNT_UNAVAILABLE" });
  });

  test("legacy mode (default) unchanged: empty body, forwarded identity", async () => {
    delete process.env.ACCOUNT_PAYMENT_COMMAND_MODE;
    post.mockResolvedValue({ status: 200, data: { data: { status: "succeeded" } } });
    await accountClient.capturePaymentIntent("pi_app", T, { headers: inboundHeaders }, command);
    const [, body, cfg] = post.mock.calls[0];
    expect(body).toEqual({});
    expect(cfg.headers.authorization).toBe("Bearer sentinel-not-forwarded");
  });
});

describe("decision claim", () => {
  test("approve and reject are mutually exclusive; same action re-uses the claim", async () => {
    const a = await decision.claimPaymentDecision({ applicationId: APP, tenantId: T, action: "approve", actorUserId: ACTOR });
    expect(a.reused).toBe(false);
    const again = await decision.claimPaymentDecision({ applicationId: APP, tenantId: T, action: "approve", actorUserId: ACTOR });
    expect(again).toEqual({ claimId: a.claimId, reused: true });
    await expect(
      decision.claimPaymentDecision({ applicationId: APP, tenantId: T, action: "reject", actorUserId: ACTOR }),
    ).rejects.toMatchObject({ status: 409, code: "PAYMENT_DECISION_CONFLICT" });
    await decision.releasePaymentDecision({ applicationId: APP, tenantId: T, claimId: "someone-else" });
    expect(app().paymentDecision.action).toBe("approve"); // a foreign claim id never releases it
  });

  test("final application is never claimed; other tenant reads as not found", async () => {
    PersonalDetails.store.find((p) => p.applicationId === APP).applicationStatus = "processed";
    await expect(
      decision.claimPaymentDecision({ applicationId: APP, tenantId: T, action: "reject", actorUserId: ACTOR }),
    ).rejects.toMatchObject({ status: 409, code: "APPLICATION_ALREADY_DECIDED" });
    await expect(
      decision.claimPaymentDecision({ applicationId: APP2, tenantId: "bbbbbbbbbbbbbbbbbbbbbbbb", action: "approve" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("POST /applications/:id/reject", () => {
  test("cancel is sent once, after the reject claim is committed, internal-only", async () => {
    let seen = null;
    post.mockImplementation(async () => {
      seen = JSON.parse(JSON.stringify(app().paymentDecision || null));
      return { status: 200, data: { data: { canceled: true } } };
    });
    const { res, err } = await invoke(profileApproval.rejectApplication, crmReq({ params: { applicationId: APP }, body: { reason: "x" } }));
    expect(err).toBeUndefined();
    expect(res.body.status).toBe("rejected");
    expect(post).toHaveBeenCalledTimes(1);
    expect(seen).toMatchObject({ action: "reject", actorUserId: ACTOR });
    const [url, body, cfg] = post.mock.calls[0];
    expect(url).toMatch(/\/pi_app\/cancel$/);
    expectInternalOnly(cfg.headers);
    expect(body).toMatchObject({ transition: "cancel", reason: "reject", actorUserId: ACTOR, binding: { applicationId: APP, paymentId: PAYMENT_ID } });
    expect(app().applicationStatus).toBe("rejected");
    expect(app().paymentDecision.completedAt).toBeTruthy();
  });

  test.each([
    ["account 409", () => post.mockResolvedValue(refused(409)), 409],
    ["account unreachable", () => post.mockRejectedValue(Object.assign(new Error("down"), { code: "ECONNREFUSED" })), 503],
  ])("%s -> application undecided, claim released", async (_n, setup, status) => {
    setup();
    const { err } = await invoke(profileApproval.rejectApplication, crmReq({ params: { applicationId: APP }, body: { reason: "x" } }));
    expect(err && err.status).toBe(status);
    expect(app().applicationStatus).toBe("submitted");
    expect(app().paymentDecision).toBeUndefined();
  });

  test("reject while an approve claim is held -> 409, no cancel", async () => {
    await decision.claimPaymentDecision({ applicationId: APP, tenantId: T, action: "approve", actorUserId: ACTOR });
    const { err } = await invoke(profileApproval.rejectApplication, crmReq({ params: { applicationId: APP }, body: { reason: "x" } }));
    expect(err).toMatchObject({ status: 409, code: "PAYMENT_DECISION_CONFLICT" });
    expect(post).not.toHaveBeenCalled();
    expect(app().applicationStatus).toBe("submitted");
  });
});

describe("POST /applications/:id/approve", () => {
  test("capture is sent only after the approve claim is committed; account 409 -> undecided, released", async () => {
    let seen = null;
    post.mockImplementation(async () => {
      seen = JSON.parse(JSON.stringify(app().paymentDecision || null));
      return refused(409, "NOT_CAPTURABLE");
    });
    const { err } = await invoke(profileApproval.approveApplication, crmReq({ params: { applicationId: APP }, body: { submission: {} } }));
    expect(err && err.status).toBe(409);
    expect(post).toHaveBeenCalledTimes(1);
    expect(seen).toMatchObject({ action: "approve", actorUserId: ACTOR });
    const [, body, cfg] = post.mock.calls[0];
    expectInternalOnly(cfg.headers);
    expect(body).toMatchObject({ transition: "capture", reason: "approve", binding: { domain: "application", applicationId: APP, purpose: "applicationFee" } });
    expect(app().applicationStatus).toBe("submitted");
    expect(app().paymentDecision).toBeUndefined();
  });

  test("account unreachable -> 503 (not masked as 409), released", async () => {
    post.mockRejectedValue(Object.assign(new Error("down"), { code: "ECONNREFUSED" }));
    const { err } = await invoke(profileApproval.approveApplication, crmReq({ params: { applicationId: APP }, body: { submission: {} } }));
    expect(err && err.status).toBe(503);
    expect(app().paymentDecision).toBeUndefined();
  });

  test("once the capture succeeded the claim stays: a later reject is refused and never cancels", async () => {
    post.mockResolvedValue({ status: 200, data: { data: { captured: true } } });
    await invoke(profileApproval.approveApplication, crmReq({ params: { applicationId: APP }, body: { submission: {} } }));
    expect(post).toHaveBeenCalledTimes(1);
    // Whether the rest of approval committed or failed after the capture, the decision is not released.
    expect(app().paymentDecision.action).toBe("approve");
    post.mockClear();
    const { err } = await invoke(profileApproval.rejectApplication, crmReq({ params: { applicationId: APP }, body: { reason: "x" } }));
    expect(err && err.status).toBe(409);
    expect(post).not.toHaveBeenCalled();
  });

  test("approve while a reject claim is held -> 409, no capture", async () => {
    await decision.claimPaymentDecision({ applicationId: APP, tenantId: T, action: "reject", actorUserId: ACTOR });
    const { err } = await invoke(profileApproval.approveApplication, crmReq({ params: { applicationId: APP }, body: { submission: {} } }));
    expect(err).toMatchObject({ status: 409, code: "PAYMENT_DECISION_CONFLICT" });
    expect(post).not.toHaveBeenCalled();
  });
});

describe("bulk approval", () => {
  test("per row: claim before capture; refused capture -> row failed, claim released; other rows unaffected", async () => {
    const seen = [];
    post.mockImplementation(async (url) => {
      const id = url.includes("pi_app2") ? APP2 : APP;
      seen.push([id, JSON.parse(JSON.stringify(app(id).paymentDecision || null))]);
      return refused(409, "PAYMENT_BINDING_MISMATCH");
    });
    const { res } = await invoke(bulkApproveApplications, crmReq({ body: { applicationIds: [APP, APP2] } }));
    expect(res.body.failed).toBe(2);
    expect(seen.map(([id, d]) => [id, d && d.action])).toEqual([[APP, "approve"], [APP2, "approve"]]);
    for (const [, , cfg] of post.mock.calls) expectInternalOnly(cfg.headers);
    expect(app(APP).paymentDecision).toBeUndefined();
    expect(app(APP2).paymentDecision).toBeUndefined();
  });

  test("row with a reject in progress is skipped without a capture", async () => {
    await decision.claimPaymentDecision({ applicationId: APP, tenantId: T, action: "reject", actorUserId: ACTOR });
    post.mockResolvedValue(refused(409));
    const { res } = await invoke(bulkApproveApplications, crmReq({ body: { applicationIds: [APP] } }));
    expect(res.body.results[0]).toMatchObject({ applicationId: APP, success: false });
    expect(post).not.toHaveBeenCalled();
    expect(app().paymentDecision.action).toBe("reject");
  });
});

describe("legacy PUT /application/status/:id", () => {
  test("processed: claim then bound capture; account 409 -> 409, released, still submitted", async () => {
    let seen = null;
    post.mockImplementation(async () => {
      seen = JSON.parse(JSON.stringify(app().paymentDecision || null));
      return refused(409);
    });
    const { err } = await invoke(applicationController.approveApplication, crmReq({ params: { applicationId: APP }, body: { applicationStatus: "processed" } }));
    expect(err && err.status).toBe(409);
    expect(seen).toMatchObject({ action: "approve" });
    const [, body, cfg] = post.mock.calls[0];
    expectInternalOnly(cfg.headers);
    expect(body).toMatchObject({ transition: "capture", binding: { applicationId: APP } });
    expect(app().applicationStatus).toBe("submitted");
    expect(app().paymentDecision).toBeUndefined();
  });

  test("rejected: bound cancel after the reject claim; decision completed", async () => {
    let seen = null;
    post.mockImplementation(async () => {
      seen = JSON.parse(JSON.stringify(app().paymentDecision || null));
      return { status: 200, data: { data: { canceled: true } } };
    });
    const { err } = await invoke(applicationController.approveApplication, crmReq({ params: { applicationId: APP }, body: { applicationStatus: "rejected" } }));
    expect(err).toBeUndefined();
    expect(seen).toMatchObject({ action: "reject" });
    expect(app().applicationStatus).toBe("rejected");
    expect(app().paymentDecision.completedAt).toBeTruthy();
  });
});

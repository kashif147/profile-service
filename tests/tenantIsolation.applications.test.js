"use strict";
/**
 * Phase 2B (C-03 / H-06 / H-07) — Tenant A/B isolation for membership
 * applications: list/filter/get/status (legacy + current approve/reject, bulk,
 * overlay/review-draft, executive council), duplicate detection/review, and
 * universal search. Real handlers/controllers/services, in-memory models.
 */
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.LOG_ROOT =
  process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-apps-"));
process.env.NODE_ENV = process.env.NODE_ENV || "test";

jest.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));
const mm = () => require("./helpers/memoryModel");
jest.mock("../models/personal.details.model.js", () => mm().createMemoryModel("PersonalDetails"));
jest.mock("../models/professional.details.model.js", () => mm().createMemoryModel("ProfessionalDetails"));
jest.mock("../models/subscription.model.js", () => mm().createMemoryModel("SubscriptionDetails"));
jest.mock("../models/profile.model.js", () => mm().createMemoryModel("Profile"));
jest.mock("../models/reviewOverlay.model.js", () => mm().createMemoryModel("ReviewOverlay"));
jest.mock("../models/user.model.js", () => mm().createMemoryModel("User"));

jest.mock("../services/account.service.client.js", () => ({
  fetchMemberFinanceSummary: jest.fn(async () => null),
  getMemberIdLookupKeys: jest.fn(() => []),
  buildHeaders: jest.fn(() => ({})),
  reassignFinanceForProfileMerge: jest.fn(async () => null),
  fetchLatestApplicationPayment: jest.fn(async () => ({ paymentIntentId: "pi_123", attemptNumber: 1 })),
  capturePaymentIntent: jest.fn(async () => ({ status: "succeeded" })),
  cancelPaymentIntent: jest.fn(async () => ({ status: "canceled", displayStatus: "Cancelled" })),
  normalizePaymentStatus: jest.fn((s) => s),
  ACCOUNT_SERVICE_URL: "http://account.test",
}));
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
jest.mock("@projectShell/rabbitmq-middleware", () => ({
  publisher: { publish: jest.fn(async () => {}) },
}));

const mongoose = require("mongoose");
const { fakeSession, mockRes } = require("./helpers/memoryModel");
const PersonalDetails = require("../models/personal.details.model.js");
const ProfessionalDetails = require("../models/professional.details.model.js");
const SubscriptionDetails = require("../models/subscription.model.js");
const Profile = require("../models/profile.model.js");
const ReviewOverlay = require("../models/reviewOverlay.model.js");
const User = require("../models/user.model.js");
const accountClient = require("../services/account.service.client.js");

const handler = require("../handlers/application.handler");
const applicationController = require("../controllers/application.controller");
const profileApproval = require("../controllers/profileApproval.controller");
const { bulkApproveApplications } = require("../controllers/bulkApproval.controller");
const { saveOverlayDraft } = require("../controllers/overlay.controller");
const { recordExecutiveCouncilDecision } = require("../services/executiveCouncilApproval.service");
const duplicateDetection = require("../services/duplicate.detection.service");
const duplicateReview = require("../services/duplicate.review.service");
const universalSearch = require("../services/universal.search.service");

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const APP_A = "app-a-1";
const APP_B = "app-b-1";
const PROF_A = "a00000000000000000000001";
const PROF_B = "b00000000000000000000001";

function personal(appId, tenantId, extra = {}) {
  return {
    applicationId: appId,
    tenantId,
    applicationStatus: "submitted",
    personalInfo: { forename: "Pat", surname: "Same", dateOfBirth: null },
    contactInfo: { personalEmail: "same.person@example.com", mobileNumber: "0870000000" },
    meta: { isActive: true, userType: "PORTAL" },
    duplicateReview: { status: "NO_MATCH", matchSummary: [] },
    createdAt: new Date("2026-10-01T00:00:00Z"),
    ...extra,
  };
}

beforeEach(() => {
  for (const M of [PersonalDetails, ProfessionalDetails, SubscriptionDetails, Profile, ReviewOverlay, User]) {
    M.reset();
  }
  jest.clearAllMocks();
  jest.spyOn(mongoose, "startSession").mockImplementation(async () => fakeSession());

  PersonalDetails.seed([personal(APP_A, A), personal(APP_B, B)]);
  ProfessionalDetails.seed([
    { applicationId: APP_A, tenantId: A, professionalDetails: { grade: "Staff Nurse", nmbiNumber: "N1" } },
    { applicationId: APP_B, tenantId: B, professionalDetails: { grade: "Staff Nurse", nmbiNumber: "N1" } },
  ]);
  SubscriptionDetails.seed([
    { applicationId: APP_A, tenantId: A, subscriptionDetails: { membershipCategory: "general" }, paymentDetails: { paymentIntentId: "pi_a" } },
    { applicationId: APP_B, tenantId: B, subscriptionDetails: { membershipCategory: "general" }, paymentDetails: { paymentIntentId: "pi_b" } },
  ]);
  Profile.seed([
    { _id: PROF_A, tenantId: A, normalizedEmail: "same.person@example.com", personalInfo: { forename: "Pat", surname: "Same" }, contactInfo: {}, professionalDetails: { nmbiNumber: "N1" } },
    { _id: PROF_B, tenantId: B, normalizedEmail: "same.person@example.com", personalInfo: { forename: "Pat", surname: "Same" }, contactInfo: {}, professionalDetails: { nmbiNumber: "N1" } },
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const crmReq = (tenantId, extra = {}) => ({
  tenantId,
  ctx: { tenantId },
  user: { id: "c00000000000000000000001", userType: "CRM", tenantId },
  userId: "c00000000000000000000001",
  headers: {},
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

describe("application lists / filters (C-03)", () => {
  test("A list sees only A applications; B sees only B", async () => {
    const a = await handler.getAllApplicationsWithDetails([], 1, 500, A);
    expect(a.applications.map((x) => x.applicationId)).toEqual([APP_A]);
    const b = await handler.getAllApplicationsWithDetails([], 1, 500, B);
    expect(b.applications.map((x) => x.applicationId)).toEqual([APP_B]);
  });

  test("template filter on a professional field never pulls another tenant's application", async () => {
    const r = await handler.getApplicationsWithTemplateFilters(
      { grade: { operator: "equal_to", values: ["Staff Nurse"] } },
      1,
      500,
      [],
      A,
    );
    expect(r.applications.map((x) => x.applicationId)).toEqual([APP_A]);
    for (const c of ProfessionalDetails.calls.filter((x) => x.op === "find")) {
      expect(c.filter.tenantId).toBe(A);
    }
  });

  test("missing tenant is rejected, never widened to all tenants", async () => {
    await expect(handler.getAllApplicationsWithDetails([], 1, 500, undefined)).rejects.toThrow(
      "Tenant context is required",
    );
    await expect(handler.getApplicationsWithTemplateFilters({}, 1, 500, [], null)).rejects.toThrow(
      "Tenant context is required",
    );
  });

  test("PUT /applications/filter controller: body tenantId is ignored", async () => {
    jest
      .spyOn(require("../services/application.filter.template.service"), "getDefaultTemplateForType")
      .mockResolvedValue({ _id: "t1", filters: {}, columns: [] });
    const { res, err } = await invoke(
      applicationController.getApplicationsWithTemplate,
      crmReq(A, { body: { tenantId: B, filters: {} } }),
    );
    expect(err).toBeUndefined();
    expect(res.body.data.applications.map((x) => x.applicationId)).toEqual([APP_A]);
  });

  test("GET /applications/:id — A cannot read B's application (404)", async () => {
    const { res } = await invoke(
      applicationController.getApplicationById,
      crmReq(A, { params: { applicationId: APP_B } }),
    );
    expect(res.statusCode).toBe(404);
    const own = await invoke(
      applicationController.getApplicationById,
      crmReq(A, { params: { applicationId: APP_A } }),
    );
    expect(own.res.statusCode).toBe(200);
    expect(own.res.body.data.applicationId).toBe(APP_A);
  });
});

describe("status changes / approval (C-03, H-06)", () => {
  test("legacy PUT /status: A cannot process B's application; no payment capture", async () => {
    const { res } = await invoke(
      applicationController.approveApplication,
      crmReq(A, { params: { applicationId: APP_B }, body: { applicationStatus: "processed" } }),
    );
    expect(res.statusCode).toBe(404);
    expect(accountClient.capturePaymentIntent).not.toHaveBeenCalled();
    expect(PersonalDetails.all().find((p) => p.applicationId === APP_B).applicationStatus).toBe("submitted");
  });

  test("handler.updateApplicationStatus: cross-tenant rejects, own tenant succeeds", async () => {
    await expect(
      handler.updateApplicationStatus(APP_B, "rejected", "u1", "x", A),
    ).rejects.toThrow("Application not found");
    expect(PersonalDetails.all().find((p) => p.applicationId === APP_B).applicationStatus).toBe("submitted");
    const ok = await handler.updateApplicationStatus(APP_A, "rejected", "u1", "x", A);
    expect(ok.applicationStatus).toBe("rejected");
  });

  test("POST /:id/approve: B's application under tenant A is 404 before any capture", async () => {
    const { err } = await invoke(
      profileApproval.approveApplication,
      crmReq(A, { params: { applicationId: APP_B }, body: { submission: {} } }),
    );
    expect(err && err.status).toBe(404);
    expect(accountClient.capturePaymentIntent).not.toHaveBeenCalled();
    expect(PersonalDetails.all().find((p) => p.applicationId === APP_B).applicationStatus).toBe("submitted");
  });

  test("POST /:id/approve with no trusted tenant is refused (no 'null passes')", async () => {
    const { err } = await invoke(
      profileApproval.approveApplication,
      crmReq(undefined, { params: { applicationId: APP_A }, body: { submission: {} } }),
    );
    expect(err && err.status).toBe(403);
    expect(accountClient.capturePaymentIntent).not.toHaveBeenCalled();
  });

  test("POST /:id/reject: A cannot reject B's application; no payment cancel", async () => {
    const { err } = await invoke(
      profileApproval.rejectApplication,
      crmReq(A, { params: { applicationId: APP_B }, body: { reason: "x" } }),
    );
    expect(err && err.status).toBe(404);
    expect(accountClient.cancelPaymentIntent).not.toHaveBeenCalled();
    expect(PersonalDetails.all().find((p) => p.applicationId === APP_B).applicationStatus).toBe("submitted");
  });

  test("POST /:id/reject: A rejects its own application; writes stay in A", async () => {
    const { res, err } = await invoke(
      profileApproval.rejectApplication,
      crmReq(A, { params: { applicationId: APP_A }, body: { reason: "x" } }),
    );
    expect(err).toBeUndefined();
    expect(res.body.status).toBe("rejected");
    expect(PersonalDetails.all().find((p) => p.applicationId === APP_A).applicationStatus).toBe("rejected");
    expect(PersonalDetails.all().find((p) => p.applicationId === APP_B).applicationStatus).toBe("submitted");
    for (const c of [...PersonalDetails.calls, ...SubscriptionDetails.calls, ...ReviewOverlay.calls].filter(
      (x) => ["updateOne", "findOne", "updateMany"].includes(x.op),
    )) {
      expect(c.filter.tenantId).toBe(A);
    }
  });

  test("bulk approval: B's id under tenant A fails as not found and B is untouched", async () => {
    const { res } = await invoke(
      bulkApproveApplications,
      crmReq(A, { body: { applicationIds: [APP_B] } }),
    );
    expect(res.body.failed).toBe(1);
    expect(res.body.results[0]).toMatchObject({ applicationId: APP_B, success: false, status: "failed" });
    expect(accountClient.capturePaymentIntent).not.toHaveBeenCalled();
    expect(PersonalDetails.all().find((p) => p.applicationId === APP_B).applicationStatus).toBe("submitted");
  });

  test("review-draft overlay: A cannot stage an overlay on B's application", async () => {
    const { err } = await invoke(
      saveOverlayDraft,
      crmReq(A, {
        params: { applicationId: APP_B },
        body: { proposedPatch: [{ op: "replace", path: "/personalInfo/forename", value: "X" }] },
      }),
    );
    expect(err && err.status).toBe(404);
    expect(ReviewOverlay.all()).toEqual([]);
  });

  test("review-draft overlay: own-tenant overlay is stamped with the trusted tenant", async () => {
    const { res, err } = await invoke(
      saveOverlayDraft,
      crmReq(A, {
        params: { applicationId: APP_A },
        body: {
          tenantId: B,
          proposedPatch: [{ op: "replace", path: "/personalInfo/forename", value: "X" }],
        },
      }),
    );
    expect(err).toBeUndefined();
    expect(res.statusCode).toBe(200);
    expect(ReviewOverlay.all()).toHaveLength(1);
    expect(ReviewOverlay.all()[0].tenantId).toBe(A);
  });

  test("approve with an overlay owned by another tenant is refused", async () => {
    ReviewOverlay.seed([
      { overlayId: "ov-b", applicationId: APP_A, tenantId: B, status: "open", overlayVersion: 1, proposedPatch: [] },
    ]);
    const { err } = await invoke(
      profileApproval.approveApplication,
      crmReq(A, { params: { applicationId: APP_A }, body: { overlayId: "ov-b", overlayVersion: 1 } }),
    );
    expect(err && err.status).toBe(404);
    expect(err.message).toBe("Overlay not found");
  });

  test("executive council: A cannot mark B's application", async () => {
    PersonalDetails.store.find((p) => p.applicationId === APP_B).applicationStatus = "processed";
    const r = await recordExecutiveCouncilDecision({
      applicationId: APP_B,
      tenantId: A,
      reviewerId: "u1",
      status: "approved",
      session: fakeSession(),
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe("Application not found");
    expect(PersonalDetails.all().find((p) => p.applicationId === APP_B).executiveCouncilApprovalDetails).toBeUndefined();
  });
});

describe("duplicate detection / review (H-07)", () => {
  test("candidates never include another tenant's application or profile", async () => {
    const r = await duplicateDetection.findDuplicateMatches(APP_A, A);
    const sources = r.matchSummary.map((m) => `${m.sourceType}:${m.sourceId}`);
    expect(sources).not.toContain(`APPLICATION:${APP_B}`);
    expect(sources).not.toContain(`PROFILE:${PROF_B}`);
    expect(sources).toContain(`PROFILE:${PROF_A}`);
  });

  test("detection requires a tenant", async () => {
    await expect(duplicateDetection.findDuplicateMatches(APP_A, "")).rejects.toMatchObject({ status: 403 });
    await expect(duplicateDetection.findProfileDuplicateMatches(PROF_A, null)).rejects.toMatchObject({ status: 403 });
  });

  test("review state / decisions: B's application is 404 for tenant A", async () => {
    await expect(duplicateReview.getDuplicateReviewState(APP_B, A)).rejects.toMatchObject({ status: 404 });
    await expect(
      duplicateReview.recordDuplicateDecision({
        applicationId: APP_B,
        tenantId: A,
        reviewerId: "u1",
        action: "MARKED_NEW",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(duplicateReview.ensureDuplicateReviewAllowsApproval(APP_B, A)).rejects.toMatchObject({
      status: 404,
    });
  });

  test("review with no request tenant is refused (previously fell back to the application's tenant)", async () => {
    await expect(duplicateReview.getDuplicateReviewState(APP_A, undefined)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe("universal search (application page)", () => {
  test("application search is tenant-scoped", async () => {
    const r = await universalSearch.search(
      "application",
      { tenantId: B },
      { search: "Same" },
      { page: 1, limit: 50 },
      { sortBy: "updatedAt", sortOrder: "desc" },
    );
    expect(r.results.map((x) => x.applicationId)).toEqual([APP_B]);
  });

  test("profile search is tenant-scoped", async () => {
    const r = await universalSearch.search(
      "profile",
      { tenantId: A },
      { email: "same.person@example.com" },
      { page: 1, limit: 50 },
      { sortBy: "updatedAt", sortOrder: "desc" },
    );
    expect(r.results.map((x) => String(x._id))).toEqual([PROF_A]);
  });

  test("search without tenant throws instead of searching everything", async () => {
    await expect(
      universalSearch.search("application", {}, {}, { page: 1, limit: 5 }, { sortBy: "updatedAt" }),
    ).rejects.toThrow("Tenant context is required");
  });
});

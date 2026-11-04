"use strict";
/**
 * P5 (#53 owner proofs) on a REAL MongoDB replica set. Skipped unless P5_DUPREVIEW_MONGO_URI is set
 * (a disposable replica set; never a shared database). Synthetic data only.
 *
 *   A1  LINK / MERGE (single + bulk) never move an existing profile's identity bindings
 *       (userId, crmUserId, normalizedEmail, contact emails) - the live incident shape: an
 *       existing profile bound to portal user X, an applicant portal user Y, LINK approve.
 *   A2  X keeps access to its profile through the portal object checks (real routers).
 *   A3  Y gains no access to X's profile / lookups / payment prefill; Y's /my-profile self-link
 *       and a Y portal-user sync event cannot take X's profile over.
 *   A4  an UNBOUND existing profile is not auto-bound to the applicant on LINK/MERGE; the
 *       applicant identity is recorded on the application as a PENDING identity-link decision.
 *   A8  the same assertion set, table-driven over single approve, bulk approval and the legacy
 *       status route (stale version, invalidated review, foreign / missing / malformed payment
 *       binding, cross tenant, Create New with a taken email, enforce preconditions, payload-
 *       bound key + replay, capture-then-persistence-failure recovered once, concurrent runs).
 *   A9  a stale worker (lease expired, another worker took the claim over) can neither release
 *       nor overwrite the new holder's claim: fenced by claimId + leaseId (single, bulk, legacy).
 *   B   reject: an unpaid application (no account payment record) is rejected without any
 *       payment mutation; a malformed / foreign record fails closed.
 * A5-A7 (version-bound decisions, re-detection preservation, recover-once) are also proven in
 * duplicateReviewRace.p5.test.js; A8 repeats them per route.
 */
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const fs = require("fs");
const http = require("http");

process.env.LOG_ROOT = process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-p5-safe-"));
process.env.JWT_SECRET = process.env.JWT_SECRET || "p5-safeguards-test-secret";

jest.mock("uuid", () => ({ v4: () => require("crypto").randomUUID() }));
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
  generateMembershipNumber: jest.fn(async () => `B9${require("crypto").randomBytes(3).toString("hex")}`),
  getCurrentYearAlphabet: jest.fn(() => "B"),
}));
jest.mock("@projectShell/rabbitmq-middleware", () => ({
  publisher: { publish: jest.fn(async () => {}) },
}));
// PDP: permit iff the exact resource:action is in the token (as portalObjectAuthz.p5.test.js).
jest.mock("../middlewares/policy.middleware", () => {
  const requirePermission = (resource, action) => (req, res, next) => {
    const perms = (req.user && req.user.permissions) || [];
    if (perms.includes(`${resource}:${action}`)) return next();
    return res.status(403).json({ code: "PDP_DENY" });
  };
  const m = { requirePermission };
  return { defaultPolicyMiddleware: m, ...m };
});
// Only the by-id read handlers are sentinels (reaching one = the object check admitted the
// caller); /my-profile and the by-user-ids lookup run for real.
jest.mock("../controllers/profile.controller.js", () => ({
  ...jest.requireActual("../controllers/profile.controller.js"),
  getProfileById: (req, res) => res.status(200).json({ reached: "getProfileById" }),
  lookupProfilesByMembershipNumbers: (req, res) => res.status(200).json({ reached: "lookupByMembership" }),
}));
jest.mock("../controllers/paymentForm.controller.js", () => ({
  ...jest.requireActual("../controllers/paymentForm.controller.js"),
  prefillPaymentForm: (req, res) => res.status(200).json({ reached: "prefillPaymentForm" }),
}));

const URI = process.env.P5_DUPREVIEW_MONGO_URI;
const d = URI ? describe : describe.skip;
// Real-database suites share one disposable replica set with the other DB suites in a parallel
// run: allow for contention (assertions unchanged).
if (URI) jest.setTimeout(30000);

d("decision safeguards (real replica set)", () => {
  let mongoose;
  let axios;
  let jwt;
  let PersonalDetails;
  let ProfessionalDetails;
  let SubscriptionDetails;
  let Profile;
  let User;
  let detection;
  let decision;
  let profileApproval;
  let bulkApproval;
  let legacy;
  let reviewController;
  let portalListener;
  let idem;
  let mockRes;
  let server;
  let baseUrl;
  const T = "a1b2c3d4e5f6a7b8c9d0e1f4";
  const T2 = "b1b2c3d4e5f6a7b8c9d0e1f4";
  const ACTOR = "c00000000000000000000003";
  const ACTOR_B = "c00000000000000000000004";
  const CRM_ORIGINAL = "c00000000000000000000099";
  const MODE = "DUPLICATE_REVIEW_VERSION_MODE";
  const PORTAL_PERMS = [
    "profile:read", "profile:write", "portal:read", "portal:write",
    "application:read", "application:write", "payments:read", "payments:write",
  ];
  let savedMode;
  let stripeCaptures;
  let stripeCancels;
  let captured;
  let post;
  let latestOverride;
  let postGate; // optional async hook run before a fake account call completes

  beforeAll(async () => {
    savedMode = process.env[MODE];
    process.env.ACCOUNT_PAYMENT_COMMAND_MODE = "bound";
    process.env.ACCOUNT_SERVICE_URL = "http://account-service:4000";
    mongoose = require("mongoose");
    axios = require("axios");
    jwt = require("jsonwebtoken");
    await mongoose.connect(URI, { dbName: "p5_decision_safeguards" });
    PersonalDetails = require("../models/personal.details.model.js");
    ProfessionalDetails = require("../models/professional.details.model.js");
    SubscriptionDetails = require("../models/subscription.model.js");
    Profile = require("../models/profile.model.js");
    User = require("../models/user.model.js");
    await Promise.all([PersonalDetails, ProfessionalDetails, SubscriptionDetails, Profile].map((M) => M.init().catch(() => {})));
    await Profile.collection.createIndex({ tenantId: 1, normalizedEmail: 1 }, { unique: true, name: "p5_tenant_email_unique" }).catch(() => {});
    detection = require("../services/duplicate.detection.service.js");
    decision = require("../services/applicationPaymentDecision.service.js");
    profileApproval = require("../controllers/profileApproval.controller.js");
    bulkApproval = require("../controllers/bulkApproval.controller.js");
    legacy = require("../controllers/application.controller.js");
    reviewController = require("../controllers/duplicateReview.controller.js");
    portalListener = require("../rabbitMQ/listeners/user.portal.listener.js");
    idem = require("../services/reviewDecisionIdempotency.js");
    ({ mockRes } = require("./helpers/memoryModel"));

    const express = require("express");
    const httpApp = express();
    httpApp.use(express.json());
    httpApp.use(require("../middlewares/response.mw"));
    httpApp.use("/api/profile", require("../routes/profile.routes"));
    const { authenticate } = require("../middlewares/auth");
    httpApp.use("/api/payment-forms", authenticate, require("../routes/paymentForm.routes"));
    // eslint-disable-next-line no-unused-vars
    httpApp.use((err, req, res, next) => res.status(err.status || 500).json({ code: err.code, error: err.message }));
    await new Promise((resolve) => {
      server = httpApp.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }, 30000);

  afterAll(async () => {
    if (savedMode === undefined) delete process.env[MODE];
    else process.env[MODE] = savedMode;
    if (server) await new Promise((r) => server.close(r));
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    delete process.env[MODE];
    idem._reset();
    stripeCaptures = 0;
    stripeCancels = 0;
    captured = new Set();
    latestOverride = null;
    postGate = null;
    post = jest.spyOn(axios, "post").mockImplementation(async (url) => {
      const pi = url.split("/intents/")[1].split("/")[0];
      if (postGate) await postGate(url);
      await new Promise((r) => setTimeout(r, 10));
      if (url.endsWith("/capture")) {
        if (captured.has(pi)) return { status: 200, data: { data: { alreadyCaptured: true } } };
        captured.add(pi);
        stripeCaptures += 1;
        return { status: 200, data: { data: { captured: true } } };
      }
      stripeCancels += 1;
      return { status: 200, data: { data: { canceled: true } } };
    });
    jest.spyOn(axios, "get").mockImplementation(async (url) => {
      const id = decodeURIComponent(url.split("/applications/")[1].split("/")[0]);
      const data = latestOverride
        ? latestOverride(id)
        : { paymentIntentId: `pi_${id}`, id: "d00000000000000000000009", attemptNumber: 1, applicationId: id };
      if (data === null) return { status: 404, data: { message: "Payment not found" } };
      return { status: 200, data: { data } };
    });
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  const uid = () => crypto.randomBytes(6).toString("hex");
  const oid = () => new mongoose.Types.ObjectId();

  // ------------------------------------------------------------------ seeds

  async function seedPortalUser({ tenantId = T, email }) {
    const _id = oid();
    const serviceId = String(oid());
    await User.collection.insertOne({
      _id,
      tenantId,
      userId: serviceId,
      userType: "PORTAL",
      userEmail: email.toLowerCase(),
      isActive: true,
    });
    return { localId: String(_id), serviceId, email: email.toLowerCase() };
  }

  async function seedApplication({ tenantId = T, email, mobile, forename = "Pat", surname = "Safe", userId = null } = {}) {
    const applicationId = crypto.randomUUID();
    await PersonalDetails.collection.insertOne({
      applicationId,
      tenantId,
      applicationStatus: "submitted",
      ...(userId ? { userId: new mongoose.Types.ObjectId(userId) } : {}),
      personalInfo: {
        title: "Mx",
        forename,
        surname,
        gender: "Other",
        dateOfBirth: new Date("1990-01-01T00:00:00Z"),
        countryPrimaryQualification: "Ireland",
      },
      contactInfo: {
        personalEmail: email || `${uid()}@example.test`,
        mobileNumber: mobile || `+35387${uid().slice(0, 7)}`,
        country: "Ireland",
        preferredEmail: "PERSONAL",
      },
      meta: { isActive: true, userType: "PORTAL" },
      duplicateReview: { status: "NOT_CHECKED", matchSummary: [] },
    });
    await ProfessionalDetails.collection.insertOne({
      applicationId,
      tenantId,
      ...(userId ? { userId: new mongoose.Types.ObjectId(userId) } : {}),
      professionalDetails: { grade: "Staff Nurse" },
    });
    await SubscriptionDetails.collection.insertOne({
      applicationId,
      tenantId,
      ...(userId ? { userId: new mongoose.Types.ObjectId(userId) } : {}),
      subscriptionDetails: { membershipCategory: "general" },
      paymentDetails: { paymentIntentId: `pi_${applicationId}` },
    });
    return applicationId;
  }

  async function seedProfile({ tenantId = T, email, mobile, userId = null, crmUserId = CRM_ORIGINAL, forename = "Pat", surname = "Safe" }) {
    const _id = oid();
    await Profile.collection.insertOne({
      _id,
      tenantId,
      normalizedEmail: email.toLowerCase(),
      membershipNumber: `B8${uid().slice(0, 5)}`,
      ...(userId ? { userId: new mongoose.Types.ObjectId(userId) } : {}),
      ...(crmUserId ? { crmUserId: new mongoose.Types.ObjectId(crmUserId) } : {}),
      personalInfo: { forename, surname, dateOfBirth: new Date("1990-01-01T00:00:00Z") },
      contactInfo: { personalEmail: email, mobileNumber: mobile, preferredEmail: "PERSONAL" },
      professionalDetails: {},
      isActive: true,
    });
    return String(_id);
  }

  const app = (applicationId) => PersonalDetails.collection.findOne({ applicationId });
  const prof = (profileId) => Profile.collection.findOne({ _id: new mongoose.Types.ObjectId(profileId) });
  const version = async (applicationId) => (await app(applicationId)).duplicateReview?.reviewVersion ?? 0;
  const profilesWithEmail = (email) => Profile.collection.countDocuments({ tenantId: T, normalizedEmail: email.toLowerCase() });
  const identityOf = (p) => ({
    userId: p.userId ? String(p.userId) : null,
    crmUserId: p.crmUserId ? String(p.crmUserId) : null,
    normalizedEmail: p.normalizedEmail,
    personalEmail: p.contactInfo?.personalEmail ?? null,
    workEmail: p.contactInfo?.workEmail ?? null,
    preferredEmail: p.contactInfo?.preferredEmail ?? null,
    membershipNumber: p.membershipNumber,
    tenantId: p.tenantId,
  });

  // ------------------------------------------------------------------ invokers

  const crmReq = ({ tenantId = T, key, actor = ACTOR, ...extra } = {}) => ({
    tenantId,
    ctx: { tenantId },
    user: { id: actor, userType: "CRM", tenantId },
    userId: actor,
    headers: { "x-correlation-id": "corr-safe", ...(key ? { "idempotency-key": key } : {}) },
    get(h) {
      return this.headers[String(h).toLowerCase()];
    },
    params: {},
    query: {},
    body: {},
    ...extra,
  });

  async function invoke(fn, req) {
    const res = mockRes();
    let err;
    await fn(req, res, (e) => {
      err = e;
    });
    return { res, err };
  }

  const approve = (applicationId, { body = {}, ...opts } = {}) =>
    invoke(profileApproval.approveApplication, crmReq({ params: { applicationId }, body: { submission: {}, ...body }, ...opts }));
  const reject = (applicationId, { body = {}, ...opts } = {}) =>
    invoke(profileApproval.rejectApplication, crmReq({ params: { applicationId }, body: { reason: "not eligible", ...body }, ...opts }));
  const bulk = (body, opts = {}) => invoke(bulkApproval.bulkApproveApplications, crmReq({ body, ...opts }));
  const legacyStatus = (applicationId, { body = {}, ...opts } = {}) =>
    invoke(legacy.approveApplication, crmReq({ params: { applicationId }, body: { applicationStatus: "processed", ...body }, ...opts }));
  const decide = (applicationId, body, opts = {}) =>
    invoke(reviewController.submitDuplicateReviewDecision, crmReq({ params: { applicationId }, body, key: `dec-${uid()}`, ...opts }));
  const rowOf = (res, applicationId) => res.body.results.find((r) => r.applicationId === applicationId);

  /** One approve decision through `route`, normalised to {status, code, body}. */
  async function decideVia(route, applicationId, { key, version: v, tenantId = T, extraBody = {}, actor } = {}) {
    const vb = v === undefined ? {} : { expectedReviewVersion: v };
    const kb = key ? { idempotencyKey: key } : {};
    const opts = { tenantId, ...(actor ? { actor } : {}) };
    if (route === "single") {
      const r = await approve(applicationId, { body: { ...vb, ...kb, ...extraBody }, ...opts });
      return r.err ? { status: r.err.status, code: r.err.code } : { status: 200, body: r.res.body };
    }
    if (route === "bulk") {
      const r = await bulk(
        {
          applicationIds: [applicationId],
          ...(v === undefined ? {} : { items: [{ applicationId, expectedReviewVersion: v }] }),
          ...kb,
          ...extraBody,
        },
        opts,
      );
      if (r.err) return { status: r.err.status, code: r.err.code };
      const row = rowOf(r.res, applicationId);
      return row.success ? { status: 200, body: row } : { status: row.httpStatus, code: row.code };
    }
    const r = await legacyStatus(applicationId, { body: { ...vb, ...kb, ...extraBody }, ...opts });
    if (r.err) return { status: r.err.status || 500, code: r.err.code };
    if (r.res.statusCode === 404) return { status: 404 };
    return { status: 200, body: r.res.body?.data };
  }

  const otherPayload = {
    single: { proposedPatch: [] },
    bulk: { processingDate: "2026-01-15" },
    legacy: { comments: "different" },
  };

  /** A POTENTIAL_MATCH application (matches another application on mobile) decided Create New. */
  async function reviewedApplication() {
    const mobile = `+35386${uid().slice(0, 7)}`;
    await seedApplication({ mobile });
    const applicationId = await seedApplication({ mobile });
    await detection.detectDuplicates(applicationId, T);
    const v0 = await version(applicationId);
    const { err } = await decide(applicationId, { action: "MARKED_NEW", expectedReviewVersion: v0 });
    expect(err).toBeUndefined();
    return { applicationId, reviewVersion: v0 + 1 };
  }

  /**
   * Incident shape: existing profile (bound to portal user X, or unbound), an applicant portal user
   * Y whose application matches it on mobile, decided LINK (or MERGE).
   */
  async function incidentShape({ bound = true, action = "LINK" } = {}) {
    const mobile = `+35385${uid().slice(0, 7)}`;
    const x = await seedPortalUser({ email: `${uid()}@owner-x.test` });
    const y = await seedPortalUser({ email: `${uid()}@applicant-y.test` });
    const profileId = await seedProfile({ email: x.email, mobile, userId: bound ? x.localId : null });
    const applicationId = await seedApplication({ email: y.email, mobile, userId: y.localId });
    await detection.detectDuplicates(applicationId, T);
    const v = await version(applicationId);
    const body = { action, sourceType: "PROFILE", sourceId: profileId, expectedReviewVersion: v };
    if (action === "MERGE") {
      // the reviewer even chooses the APPLICATION's email: identity must still not move
      body.mergeFieldChoices = { "personalInfo.forename": "APPLICATION", "contactInfo.personalEmail": "APPLICATION" };
    }
    const { err } = await decide(applicationId, body);
    expect(err).toBeUndefined();
    return { x, y, profileId, applicationId, reviewVersion: v + 1, before: identityOf(await prof(profileId)) };
  }

  // ------------------------------------------------------------------ portal HTTP

  const portalToken = (u) =>
    `Bearer ${jwt.sign({ sub: u.serviceId, tenantId: T, userType: "PORTAL", email: u.email, permissions: PORTAL_PERMS }, process.env.JWT_SECRET)}`;

  function call(method, url, user, body) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const req = http.request(
        `${baseUrl}${url}`,
        {
          method,
          headers: {
            authorization: portalToken(user),
            ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            let parsed = null;
            try {
              parsed = raw ? JSON.parse(raw) : null;
            } catch (_e) {
              parsed = raw;
            }
            resolve({ status: res.statusCode, body: parsed });
          });
        },
      );
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  }

  async function portalAccess(user, profileId) {
    const p = await prof(profileId);
    const byId = await call("GET", `/api/profile/${profileId}`, user);
    const prefill = await call("GET", `/api/payment-forms/prefill?profileId=${profileId}`, user);
    const byMembership = await call("POST", "/api/profile/lookup-by-membership", user, { membershipNumbers: [p.membershipNumber] });
    const myProfile = await call("GET", "/api/profile/my-profile", user);
    const ownLookup = await call("POST", "/api/profile/internal/by-user-ids", user, { userIds: [user.serviceId] });
    const ownLookupText = JSON.stringify(ownLookup.body || {});
    return {
      byId: byId.status,
      prefill: prefill.status,
      byMembership: byMembership.status,
      myProfileId: myProfile.body?.data?.profileId ? String(myProfile.body.data.profileId) : null,
      ownLookupHasProfile: ownLookup.status === 200 && ownLookupText.includes(profileId),
    };
  }

  // ================================================================== A1-A4 identity

  describe("A1-A4 identity bindings on LINK / MERGE (incident shape)", () => {
    test.each([
      ["single", "LINK"],
      ["single", "MERGE"],
      ["bulk", "LINK"],
      ["bulk", "MERGE"],
    ])("A1 %s %s: X's profile keeps userId / crmUserId / normalizedEmail / contact emails; applicant stays on the application", async (route, action) => {
      const s = await incidentShape({ bound: true, action });
      const out = await decideVia(route, s.applicationId, { key: `k-${uid()}`, version: s.reviewVersion });
      expect(out.status).toBe(200);
      const after = await prof(s.profileId);
      expect(identityOf(after)).toEqual(s.before); // nothing identity-related moved
      expect(String(after.userId)).toBe(s.x.localId); // stays X (incident: moved to Y)
      const a = await app(s.applicationId);
      expect(a.applicationStatus).toBe("processed");
      expect(String(a.profileId)).toBe(s.profileId);
      expect(String(a.userId)).toBe(s.y.localId); // the application still belongs to the applicant
      expect(String((await ProfessionalDetails.collection.findOne({ applicationId: s.applicationId })).userId)).toBe(s.y.localId);
      expect(String((await SubscriptionDetails.collection.findOne({ applicationId: s.applicationId })).userId)).toBe(s.y.localId);
      expect(a.identityLink).toMatchObject({
        status: "PENDING",
        reason: "PROFILE_BOUND_TO_OTHER_USER",
        profileId: s.profileId,
        applicantUserId: s.y.localId,
        profileBound: true,
      });
      const reported = route === "single" ? out.body.identityLink : out.body.identityLink;
      expect(reported).toMatchObject({ status: "PENDING", reason: "PROFILE_BOUND_TO_OTHER_USER" });
    });

    test("A2 + A3: X keeps access, Y gets none - profile by id, payment prefill, membership lookup, my-profile, by-user-ids", async () => {
      const s = await incidentShape({ bound: true, action: "LINK" });
      const out = await decideVia("single", s.applicationId, { key: `k-${uid()}`, version: s.reviewVersion });
      expect(out.status).toBe(200);

      const ofX = await portalAccess(s.x, s.profileId);
      expect(ofX).toEqual({ byId: 200, prefill: 200, byMembership: 200, myProfileId: s.profileId, ownLookupHasProfile: true });

      const ofY = await portalAccess(s.y, s.profileId);
      expect(ofY).toEqual({ byId: 403, prefill: 403, byMembership: 403, myProfileId: null, ownLookupHasProfile: false });
      // Y's /my-profile did not self-link X's profile, and X still owns it
      expect(String((await prof(s.profileId)).userId)).toBe(s.x.localId);
    });

    test("A3: a portal user whose email / member number matches a BOUND profile cannot take it over (/my-profile and user.portal.created)", async () => {
      const x = await seedPortalUser({ email: `${uid()}@owner-x.test` });
      const profileId = await seedProfile({ email: x.email, mobile: `+35384${uid().slice(0, 7)}`, userId: x.localId });
      const member = (await prof(profileId)).membershipNumber;
      // a second portal user presenting X's email (token claim) and X's membership number
      const y = await seedPortalUser({ email: `${uid()}@other-y.test` });
      await User.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(y.localId) },
        { $unset: { userEmail: "" }, $set: { userMemberNumber: member } },
      );
      const myProfile = await call("GET", "/api/profile/my-profile", { ...y, email: x.email });
      expect(myProfile.status).toBe(200);
      expect(myProfile.body?.data ?? null).toBeNull(); // no profile returned / linked
      await portalListener.handlePortalUserCreated({
        tenantId: T,
        // portal users are unique per tenant+email, so the sync vector is the membership number
        data: { userId: y.serviceId, tenantId: T, userEmail: y.email, userMemberNumber: member },
      });
      expect(String((await prof(profileId)).userId)).toBe(x.localId);
      expect((await portalAccess(y, profileId)).byId).toBe(403);
      expect((await portalAccess(x, profileId)).byId).toBe(200);
    });

    test.each([["single"], ["bulk"]])("A4 %s: an UNBOUND existing profile is not bound to the applicant; pending identity-link decision recorded", async (route) => {
      const s = await incidentShape({ bound: false, action: "LINK" });
      const out = await decideVia(route, s.applicationId, { key: `k-${uid()}`, version: s.reviewVersion });
      expect(out.status).toBe(200);
      const after = await prof(s.profileId);
      expect(after.userId ?? null).toBeNull();
      expect(identityOf(after)).toEqual(s.before);
      const a = await app(s.applicationId);
      expect(String(a.userId)).toBe(s.y.localId);
      expect(a.identityLink).toMatchObject({ status: "PENDING", reason: "PROFILE_UNBOUND", profileBound: false, applicantUserId: s.y.localId });
      // exposed on the duplicate-review state for the CRM decision
      const state = await invoke(reviewController.getDuplicateMatches, crmReq({ params: { applicationId: s.applicationId } }));
      expect(state.err).toBeUndefined();
      expect(state.res.body.data.identityLink).toMatchObject({ status: "PENDING", reason: "PROFILE_UNBOUND" });
      // the applicant has no access to the (still unbound) profile
      expect((await portalAccess(s.y, s.profileId)).byId).toBe(403);
    });
  });

  // ================================================================== A8 table

  const ROUTES = [["single"], ["bulk"], ["legacy"]];

  describe.each(ROUTES)("A8 same safeguards: %s", (route) => {
    test("stale expectedReviewVersion -> 409 REVIEW_VERSION_CONFLICT, no claim, no capture", async () => {
      const { applicationId, reviewVersion } = await reviewedApplication();
      const out = await decideVia(route, applicationId, { key: `k-${uid()}`, version: reviewVersion - 1 });
      expect(out).toMatchObject({ status: 409, code: "REVIEW_VERSION_CONFLICT" });
      expect(post).not.toHaveBeenCalled();
      expect((await app(applicationId)).paymentDecision).toBeUndefined();
    });

    test("A5: a decision invalidated by an input change is refused before any capture", async () => {
      const { applicationId, reviewVersion } = await reviewedApplication();
      await PersonalDetails.collection.updateOne({ applicationId }, { $set: { "contactInfo.mobileNumber": `+35388${uid().slice(0, 7)}` } });
      await detection.detectDuplicates(applicationId, T);
      const out = await decideVia(route, applicationId, { key: `k-${uid()}`, version: reviewVersion });
      expect(out.status).toBeGreaterThanOrEqual(409);
      expect(["REVIEW_VERSION_CONFLICT", "DUPLICATE_REVIEW_REQUIRED"]).toContain(out.code);
      expect(post).not.toHaveBeenCalled();
      // without a version (compat) the gate still refuses
      const noVersion = await decideVia(route, applicationId, { key: `k-${uid()}` });
      expect(noVersion.code).toBe("DUPLICATE_REVIEW_REQUIRED");
      expect(post).not.toHaveBeenCalled();
    });

    test("A6: unchanged-input re-detection keeps the decision; the decision still approves", async () => {
      const { applicationId, reviewVersion } = await reviewedApplication();
      for (let i = 0; i < 2; i++) await detection.detectDuplicates(applicationId, T);
      expect((await app(applicationId)).duplicateReview.status).toBe("MARKED_NEW");
      expect(await version(applicationId)).toBe(reviewVersion);
      const out = await decideVia(route, applicationId, { key: `k-${uid()}`, version: reviewVersion });
      expect(out.status).toBe(200);
      expect(stripeCaptures).toBe(1);
    });

    test("payment bound to another application / malformed record / no record -> fail closed, nothing captured", async () => {
      const a1 = await reviewedApplication();
      latestOverride = (id) => ({ paymentIntentId: `pi_${id}`, id: "d0000000000000000000000a", attemptNumber: 1, applicationId: "another-app" });
      expect(await decideVia(route, a1.applicationId, { key: `k-${uid()}`, version: a1.reviewVersion })).toMatchObject({ status: 409, code: "PAYMENT_APPLICATION_MISMATCH" });
      latestOverride = (id) => ({ paymentIntentId: `pi_${id}`, id: "d0000000000000000000000b", attemptNumber: 1 });
      expect(await decideVia(route, a1.applicationId, { key: `k-${uid()}`, version: a1.reviewVersion })).toMatchObject({ status: 409, code: "PAYMENT_BINDING_MISSING" });
      latestOverride = () => null; // only a local intent: approving must not proceed
      expect(await decideVia(route, a1.applicationId, { key: `k-${uid()}`, version: a1.reviewVersion })).toMatchObject({ status: 409, code: "PAYMENT_BINDING_MISSING" });
      expect(post).not.toHaveBeenCalled();
      const doc = await app(a1.applicationId);
      expect(doc.applicationStatus).toBe("submitted");
      expect(doc.paymentDecision).toBeUndefined();
    });

    test("cross-tenant application -> 404, nothing called", async () => {
      const { applicationId, reviewVersion } = await reviewedApplication();
      const out = await decideVia(route, applicationId, { key: `k-${uid()}`, version: reviewVersion, tenantId: T2 });
      expect(out.status).toBe(404);
      expect(post).not.toHaveBeenCalled();
      expect((await app(applicationId)).paymentDecision).toBeUndefined();
    });

    test("Create New with an email a profile now holds -> 409 PROFILE_EMAIL_EXISTS before capture", async () => {
      const { applicationId, reviewVersion } = await reviewedApplication();
      await seedProfile({ email: (await app(applicationId)).contactInfo.personalEmail, mobile: `+35382${uid().slice(0, 7)}` });
      expect(await decideVia(route, applicationId, { key: `k-${uid()}`, version: reviewVersion })).toMatchObject({ status: 409, code: "PROFILE_EMAIL_EXISTS" });
      expect(post).not.toHaveBeenCalled();
    });

    test("enforce: no key -> 428, no version -> 428; both -> decided", async () => {
      process.env[MODE] = "enforce";
      const { applicationId, reviewVersion } = await reviewedApplication();
      expect(await decideVia(route, applicationId, { version: reviewVersion })).toMatchObject({ status: 428, code: "IDEMPOTENCY_KEY_REQUIRED" });
      expect(await decideVia(route, applicationId, { key: `k-${uid()}` })).toMatchObject({ status: 428, code: "REVIEW_VERSION_REQUIRED" });
      expect(post).not.toHaveBeenCalled();
      expect((await decideVia(route, applicationId, { key: `k-${uid()}`, version: reviewVersion })).status).toBe(200);
    });

    test("operation key: same key + same payload replays; same key + other payload -> 422; new key -> 409", async () => {
      const { applicationId, reviewVersion } = await reviewedApplication();
      const key = `k-${uid()}`;
      expect((await decideVia(route, applicationId, { key, version: reviewVersion })).status).toBe(200);
      const again = await decideVia(route, applicationId, { key, version: reviewVersion });
      expect(again.status).toBe(200);
      expect(again.body.replayed).toBe(true);
      expect(await decideVia(route, applicationId, { key, version: reviewVersion, extraBody: otherPayload[route] })).toMatchObject({ status: 422, code: "IDEMPOTENCY_KEY_REUSED" });
      expect(await decideVia(route, applicationId, { key: `k-${uid()}`, version: reviewVersion })).toMatchObject({ status: 409, code: "APPLICATION_ALREADY_DECIDED" });
      expect(stripeCaptures).toBe(1);
    });

    test("A7: capture succeeds then persistence fails -> the same action recovers exactly once", async () => {
      const { applicationId, reviewVersion } = await reviewedApplication();
      const email = (await app(applicationId)).contactInfo.personalEmail;
      const realUpdateOne = PersonalDetails.updateOne.bind(PersonalDetails);
      let failed = false;
      jest.spyOn(PersonalDetails, "updateOne").mockImplementation((filter, update, ...rest) => {
        if (!failed && update?.$set?.applicationStatus === "processed") {
          failed = true;
          throw new Error("simulated persistence failure after capture");
        }
        return realUpdateOne(filter, update, ...rest);
      });
      const key = `k-${uid()}`;
      const first = await decideVia(route, applicationId, { key, version: reviewVersion });
      expect(first.status).not.toBe(200);
      expect(failed).toBe(true);
      expect(stripeCaptures).toBe(1);
      let a = await app(applicationId);
      expect(a.applicationStatus).toBe("submitted");
      expect(a.paymentDecision.action).toBe("approve"); // money moved: claim kept
      expect(a.paymentDecision.leaseId).toBeUndefined(); // lease ended: recovery can start now
      expect(await profilesWithEmail(email)).toBe(0);
      // the opposite decision stays blocked
      const rej = await reject(applicationId, { body: { idempotencyKey: `r-${uid()}` } });
      expect(rej.err).toMatchObject({ status: 409, code: "PAYMENT_DECISION_CONFLICT" });
      const second = await decideVia(route, applicationId, { key, version: reviewVersion });
      expect(second.status).toBe(200);
      expect(stripeCaptures).toBe(1);
      a = await app(applicationId);
      expect(a.applicationStatus).toBe("processed");
      expect(await profilesWithEmail(email)).toBe(route === "legacy" ? 0 : 1); // legacy never creates profiles
    });

    test("concurrent runs of the same route: one decision, one capture", async () => {
      const { applicationId, reviewVersion } = await reviewedApplication();
      const results = await Promise.all(
        [1, 2, 3].map(() => decideVia(route, applicationId, { key: `k-${uid()}`, version: reviewVersion })),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      for (const r of results.filter((x) => x.status !== 200)) expect(r.status).toBe(409);
      expect(stripeCaptures).toBe(1);
      expect((await app(applicationId)).applicationStatus).toBe("processed");
    });
  });

  // ================================================================== A9 fencing

  describe("A9 a stale worker cannot release or overwrite the new holder's claim", () => {
    async function expireLease(applicationId) {
      await PersonalDetails.collection.updateOne({ applicationId }, { $set: { "paymentDecision.leaseUntil": new Date(0) } });
    }

    test("service level: after a takeover, the old lease's release / lease-end / lock / final write change nothing", async () => {
      const { applicationId, reviewVersion } = await reviewedApplication();
      const a = await decision.claimPaymentDecision({ applicationId, tenantId: T, action: "approve", actorUserId: ACTOR, reviewVersion });
      await expireLease(applicationId);
      const b = await decision.claimPaymentDecision({ applicationId, tenantId: T, action: "approve", actorUserId: ACTOR_B, reviewVersion });
      expect(b).toMatchObject({ claimId: a.claimId, reused: true });
      expect(b.leaseId).not.toBe(a.leaseId);
      await decision.releasePaymentDecision({ applicationId, tenantId: T, ...a });
      await decision.endPaymentDecisionLease({ applicationId, tenantId: T, ...a });
      await expect(
        decision.lockReviewForDecision({ applicationId, tenantId: T, decisionClaim: a, reviewVersion, session: null, reviewChanged: () => new Error("x") }),
      ).rejects.toMatchObject({ status: 409, code: "DECISION_LEASE_LOST" });
      await expect(
        decision.fencedDecisionUpdate({ applicationId, tenantId: T, decisionClaim: a, update: { $set: { applicationStatus: "processed" } } }),
      ).rejects.toMatchObject({ status: 409, code: "DECISION_LEASE_LOST" });
      const doc = await app(applicationId);
      expect(doc.applicationStatus).toBe("submitted");
      expect(doc.paymentDecision).toMatchObject({ claimId: b.claimId, leaseId: b.leaseId, action: "approve" });
      // B's live lease still excludes a third run
      const c = await decideVia("single", applicationId, { key: `k-${uid()}`, version: reviewVersion });
      expect(c).toMatchObject({ status: 409, code: "DECISION_IN_PROGRESS" });
    });

    test.each([["single"], ["bulk"]])("%s: worker A stalls after its claim, its lease expires, B takes over; A fails with DECISION_LEASE_LOST and leaves B's claim intact", async (route) => {
      const { applicationId, reviewVersion } = await reviewedApplication();
      let entered;
      let releaseA;
      const enteredP = new Promise((r) => (entered = r));
      const gate = new Promise((r) => (releaseA = r));
      const realStart = mongoose.startSession.bind(mongoose);
      jest.spyOn(mongoose, "startSession").mockImplementationOnce(async (...args) => {
        entered();
        await gate;
        return realStart(...args);
      });
      const runA = decideVia(route, applicationId, { key: `ka-${uid()}`, version: reviewVersion });
      await enteredP; // A holds the claim, before its transaction
      const heldByA = (await app(applicationId)).paymentDecision;
      await expireLease(applicationId);
      const b = await decision.claimPaymentDecision({ applicationId, tenantId: T, action: "approve", actorUserId: ACTOR_B, reviewVersion });
      expect(b.leaseId).not.toBe(heldByA.leaseId);
      releaseA();
      const outA = await runA;
      expect(outA).toMatchObject({ status: 409, code: "DECISION_LEASE_LOST" });
      expect(post).not.toHaveBeenCalled(); // A never captured
      const doc = await app(applicationId);
      expect(doc.applicationStatus).toBe("submitted");
      expect(doc.paymentDecision).toMatchObject({ claimId: b.claimId, leaseId: b.leaseId });
    });

    test("legacy: worker A stalls inside its capture, B takes over; A's fenced final write fails and B's claim stays", async () => {
      const { applicationId, reviewVersion } = await reviewedApplication();
      let entered;
      let releaseA;
      const enteredP = new Promise((r) => (entered = r));
      const gate = new Promise((r) => (releaseA = r));
      let first = true;
      postGate = async () => {
        if (!first) return;
        first = false;
        entered();
        await gate;
      };
      const runA = decideVia("legacy", applicationId, { key: `ka-${uid()}`, version: reviewVersion, actor: ACTOR });
      await enteredP;
      await expireLease(applicationId);
      const b = await decision.claimPaymentDecision({ applicationId, tenantId: T, action: "approve", actorUserId: ACTOR_B, reviewVersion });
      releaseA();
      const outA = await runA;
      expect(outA).toMatchObject({ status: 409, code: "DECISION_LEASE_LOST" });
      const doc = await app(applicationId);
      expect(doc.applicationStatus).toBe("submitted"); // A wrote no final state
      expect(doc.paymentDecision).toMatchObject({ claimId: b.claimId, leaseId: b.leaseId, action: "approve" });
      expect(doc.approvalDetails?.approvedBy ?? null).toBeNull();
    });
  });

  // ================================================================== B reject policy

  describe("B reject payment policy", () => {
    test.each([["single"], ["legacy"]])("%s: no account payment record -> rejected without any payment mutation", async (route) => {
      const { applicationId, reviewVersion } = await reviewedApplication();
      latestOverride = () => null; // unpaid: account has no payment for the application
      const body = { expectedReviewVersion: reviewVersion, idempotencyKey: `r-${uid()}` };
      const out =
        route === "single"
          ? await reject(applicationId, { body })
          : await legacyStatus(applicationId, { body: { ...body, applicationStatus: "rejected" } });
      expect(out.err).toBeUndefined();
      expect(post).not.toHaveBeenCalled();
      expect((await app(applicationId)).applicationStatus).toBe("rejected");
    });

    test.each([["single"], ["legacy"]])("%s: malformed or foreign account record -> 409 fail closed, no cancel", async (route) => {
      const { applicationId, reviewVersion } = await reviewedApplication();
      for (const [record, code] of [
        [(id) => ({ paymentIntentId: `pi_${id}`, id: "d0000000000000000000000c", attemptNumber: 1 }), "PAYMENT_BINDING_MISSING"],
        [(id) => ({ paymentIntentId: `pi_${id}`, id: "d0000000000000000000000d", attemptNumber: 1, applicationId: "other" }), "PAYMENT_APPLICATION_MISMATCH"],
      ]) {
        latestOverride = record;
        const body = { expectedReviewVersion: reviewVersion, idempotencyKey: `r-${uid()}` };
        const out =
          route === "single"
            ? await reject(applicationId, { body })
            : await legacyStatus(applicationId, { body: { ...body, applicationStatus: "rejected" } });
        expect(out.err).toMatchObject({ status: 409, code });
      }
      expect(post).not.toHaveBeenCalled();
      const doc = await app(applicationId);
      expect(doc.applicationStatus).toBe("submitted");
      expect(doc.paymentDecision).toBeUndefined();
    });

    test("enforce: reject requires expectedReviewVersion (428) and checks it (409)", async () => {
      process.env[MODE] = "enforce";
      const { applicationId, reviewVersion } = await reviewedApplication();
      const noVersion = await reject(applicationId, { body: { idempotencyKey: `r-${uid()}` } });
      expect(noVersion.err).toMatchObject({ status: 428, code: "REVIEW_VERSION_REQUIRED" });
      const stale = await reject(applicationId, { body: { idempotencyKey: `r-${uid()}`, expectedReviewVersion: reviewVersion + 3 } });
      expect(stale.err).toMatchObject({ status: 409, code: "REVIEW_VERSION_CONFLICT" });
      expect(post).not.toHaveBeenCalled();
      const ok = await reject(applicationId, { body: { idempotencyKey: `r-${uid()}`, expectedReviewVersion: reviewVersion } });
      expect(ok.err).toBeUndefined();
      expect(stripeCancels).toBe(1);
    });
  });

  // ================================================================== C evidence log

  test("C: every decision request logs one [decision-preconditions] observed line per route", async () => {
    const { applicationId, reviewVersion } = await reviewedApplication();
    await decideVia("single", applicationId, { key: `k-${uid()}`, version: reviewVersion });
    const lines = console.info.mock.calls.filter((c) => c[0] === "[decision-preconditions] observed").map((c) => c[1]);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ route: "duplicate-review", idempotencyKey: true, expectedReviewVersion: true }),
        expect.objectContaining({ route: "approve", mode: "compat", idempotencyKey: true, expectedReviewVersion: true, versionRequired: true }),
      ]),
    );
  });
});

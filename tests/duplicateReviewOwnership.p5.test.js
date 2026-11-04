"use strict";
/**
 * P5 (#53 follow-up): bulk approval version lock, ownership on every decision path, and the
 * DUPLICATE_REVIEW_VERSION_MODE compat/enforce preconditions - on a REAL MongoDB replica set
 * (transactions and conditional-update atomicity are the database's). Skipped unless
 * P5_DUPREVIEW_MONGO_URI is set (a disposable replica set; never a shared database).
 * Synthetic data only.
 */
const crypto = require("crypto");

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

const URI = process.env.P5_DUPREVIEW_MONGO_URI;
const d = URI ? describe : describe.skip;

d("duplicate review ownership / bulk / version mode (real replica set)", () => {
  let mongoose;
  let axios;
  let PersonalDetails;
  let ProfessionalDetails;
  let SubscriptionDetails;
  let Profile;
  let detection;
  let profileApproval;
  let bulkApproval;
  let legacy;
  let reviewController;
  let idem;
  let mockRes;
  const T = "a1b2c3d4e5f6a7b8c9d0e1f3";
  const T2 = "b1b2c3d4e5f6a7b8c9d0e1f3";
  const ACTOR = "c00000000000000000000002";
  const MODE = "DUPLICATE_REVIEW_VERSION_MODE";
  let savedMode;
  // fake account/Stripe
  let stripeCaptures;
  let stripeCancels;
  let captured;
  let post;
  let latestOverride; // (applicationId) => account latest-payment response data | null (404)

  beforeAll(async () => {
    savedMode = process.env[MODE];
    process.env.ACCOUNT_PAYMENT_COMMAND_MODE = "bound";
    process.env.ACCOUNT_SERVICE_URL = "http://account-service:4000";
    mongoose = require("mongoose");
    axios = require("axios");
    // Own database on the shared disposable replica set: duplicateReviewRace.p5.test.js reads the
    // same URI and drops its database in afterAll, so parallel jest workers must not share one.
    await mongoose.connect(URI, { dbName: "p5_dupreview_ownership" });
    PersonalDetails = require("../models/personal.details.model.js");
    ProfessionalDetails = require("../models/professional.details.model.js");
    SubscriptionDetails = require("../models/subscription.model.js");
    Profile = require("../models/profile.model.js");
    require("../models/user.model.js");
    await Promise.all([PersonalDetails, ProfessionalDetails, SubscriptionDetails, Profile].map((M) => M.init().catch(() => {})));
    await Profile.collection.createIndex({ tenantId: 1, normalizedEmail: 1 }, { unique: true, name: "p5_tenant_email_unique" }).catch(() => {});
    detection = require("../services/duplicate.detection.service.js");
    profileApproval = require("../controllers/profileApproval.controller.js");
    bulkApproval = require("../controllers/bulkApproval.controller.js");
    legacy = require("../controllers/application.controller.js");
    reviewController = require("../controllers/duplicateReview.controller.js");
    idem = require("../services/reviewDecisionIdempotency.js");
    ({ mockRes } = require("./helpers/memoryModel"));
    // Connect + index builds on a fresh database can exceed jest's 5s default under a parallel run.
  }, 30000);

  afterAll(async () => {
    if (savedMode === undefined) delete process.env[MODE];
    else process.env[MODE] = savedMode;
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
    post = jest.spyOn(axios, "post").mockImplementation(async (url) => {
      const pi = url.split("/intents/")[1].split("/")[0];
      await new Promise((r) => setTimeout(r, 15)); // network latency: widens race windows
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
        : { paymentIntentId: `pi_${id}`, id: "d00000000000000000000002", attemptNumber: 1, applicationId: id };
      if (data === null) return { status: 404, data: { message: "Payment not found" } };
      return { status: 200, data: { data } };
    });
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  const uid = () => crypto.randomBytes(6).toString("hex");

  async function seedApplication({ tenantId = T, email, mobile, forename = "Pat", surname = "Owner" } = {}) {
    const applicationId = crypto.randomUUID();
    await PersonalDetails.collection.insertOne({
      applicationId,
      tenantId,
      applicationStatus: "submitted",
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
      },
      meta: { isActive: true, userType: "PORTAL" },
      duplicateReview: { status: "NOT_CHECKED", matchSummary: [] },
    });
    await ProfessionalDetails.collection.insertOne({ applicationId, tenantId, professionalDetails: { grade: "Staff Nurse" } });
    await SubscriptionDetails.collection.insertOne({
      applicationId,
      tenantId,
      subscriptionDetails: { membershipCategory: "general" },
      paymentDetails: { paymentIntentId: `pi_${applicationId}` },
    });
    return applicationId;
  }

  async function seedProfile({ tenantId = T, email, mobile, forename = "Pat", surname = "Owner" }) {
    const _id = new mongoose.Types.ObjectId();
    await Profile.collection.insertOne({
      _id,
      tenantId,
      normalizedEmail: email.toLowerCase(),
      membershipNumber: `B8${uid().slice(0, 5)}`,
      personalInfo: { forename, surname, dateOfBirth: new Date("1990-01-01T00:00:00Z") },
      contactInfo: { personalEmail: email, mobileNumber: mobile },
      professionalDetails: {},
      isActive: true,
    });
    return String(_id);
  }

  const app = (applicationId) => PersonalDetails.collection.findOne({ applicationId });
  const version = async (applicationId) => (await app(applicationId)).duplicateReview?.reviewVersion ?? 0;
  const profilesWithEmail = (email) => Profile.collection.countDocuments({ tenantId: T, normalizedEmail: email.toLowerCase() });

  const crmReq = ({ tenantId = T, key, ...extra } = {}) => ({
    tenantId,
    ctx: { tenantId },
    user: { id: ACTOR, userType: "CRM", tenantId },
    userId: ACTOR,
    headers: { "x-correlation-id": "corr-own", ...(key ? { "idempotency-key": key } : {}) },
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
    invoke(reviewController.submitDuplicateReviewDecision, crmReq({ params: { applicationId }, body, ...opts }));
  const rowOf = (res, applicationId) => res.body.results.find((r) => r.applicationId === applicationId);

  /** A POTENTIAL_MATCH application (matches another application on mobile) decided Create New. */
  async function reviewedApplication() {
    const mobile = `+35386${uid().slice(0, 7)}`;
    await seedApplication({ mobile });
    const applicationId = await seedApplication({ mobile });
    await detection.detectDuplicates(applicationId, T);
    const v0 = await version(applicationId);
    const { err } = await decide(applicationId, { action: "MARKED_NEW", expectedReviewVersion: v0 }, { key: `dec-${uid()}` });
    expect(err).toBeUndefined();
    return { applicationId, reviewVersion: v0 + 1, mobile };
  }

  /** An application LINKED to a same-tenant profile that matches on mobile. */
  async function linkedApplication() {
    const mobile = `+35385${uid().slice(0, 7)}`;
    const profileEmail = `${uid()}@member.test`;
    const profileId = await seedProfile({ email: profileEmail, mobile });
    const applicationId = await seedApplication({ mobile });
    await detection.detectDuplicates(applicationId, T);
    const v = await version(applicationId);
    const { err } = await decide(
      applicationId,
      { action: "LINK", sourceType: "PROFILE", sourceId: profileId, expectedReviewVersion: v },
      { key: `dec-${uid()}` },
    );
    expect(err).toBeUndefined();
    return { applicationId, profileId, profileEmail, reviewVersion: v + 1 };
  }

  // ---------------------------------------------------------------- bulk path

  describe("bulk approval applies the single-approval version lock per application", () => {
    test("a stale expectedReviewVersion fails that row with 409, no claim and no capture", async () => {
      const { applicationId, reviewVersion } = await reviewedApplication();
      const { res, err } = await bulk({
        applicationIds: [applicationId],
        items: [{ applicationId, expectedReviewVersion: reviewVersion - 1 }],
      }, { key: "bulk-stale" });
      expect(err).toBeUndefined();
      expect(rowOf(res, applicationId)).toMatchObject({ success: false, code: "REVIEW_VERSION_CONFLICT", httpStatus: 409 });
      expect(post).not.toHaveBeenCalled();
      const a = await app(applicationId);
      expect(a.applicationStatus).toBe("submitted");
      expect(a.paymentDecision).toBeUndefined();
    });

    test("an invalidated review (input changed after the decision) fails the row before any capture", async () => {
      const { applicationId, reviewVersion } = await reviewedApplication();
      await PersonalDetails.collection.updateOne({ applicationId }, { $set: { "contactInfo.mobileNumber": `+35388${uid().slice(0, 7)}` } });
      await detection.detectDuplicates(applicationId, T); // invalidates MARKED_NEW (fresh review)
      const { res } = await bulk({ applicationIds: [applicationId], items: [{ applicationId, expectedReviewVersion: reviewVersion }] });
      const row = rowOf(res, applicationId);
      expect(row.success).toBe(false);
      expect(["REVIEW_VERSION_CONFLICT", "DUPLICATE_REVIEW_REQUIRED"]).toContain(row.code);
      expect(post).not.toHaveBeenCalled();
      expect((await app(applicationId)).paymentDecision).toBeUndefined();
    });

    test("valid + stale rows: only the valid rows are processed and captured", async () => {
      const good1 = await reviewedApplication();
      const stale = await reviewedApplication();
      const good2 = await reviewedApplication();
      const { res } = await bulk({
        applicationIds: [good1.applicationId, stale.applicationId, good2.applicationId],
        items: [
          { applicationId: good1.applicationId, expectedReviewVersion: good1.reviewVersion },
          { applicationId: stale.applicationId, expectedReviewVersion: stale.reviewVersion + 5 },
          { applicationId: good2.applicationId, expectedReviewVersion: good2.reviewVersion },
        ],
      });
      expect(res.body).toMatchObject({ total: 3, successful: 2, failed: 1 });
      expect(rowOf(res, stale.applicationId)).toMatchObject({ success: false, code: "REVIEW_VERSION_CONFLICT" });
      expect(stripeCaptures).toBe(2);
      expect(captured.has(`pi_${stale.applicationId}`)).toBe(false);
      expect((await app(good1.applicationId)).applicationStatus).toBe("processed");
      expect((await app(good2.applicationId)).applicationStatus).toBe("processed");
      expect((await app(stale.applicationId)).applicationStatus).toBe("submitted");
      expect((await app(good1.applicationId)).paymentDecision.reviewVersion).toBe(good1.reviewVersion);
    });

    test("concurrent single + bulk approval of one application: one decision, one capture, one profile", async () => {
      for (let round = 0; round < 6; round++) {
        const { applicationId, reviewVersion } = await reviewedApplication();
        const email = (await app(applicationId)).contactInfo.personalEmail;
        const before = stripeCaptures;
        const [single, many] = await Promise.all([
          approve(applicationId, { body: { expectedReviewVersion: reviewVersion }, key: `s-${round}` }),
          bulk({ applicationIds: [applicationId], items: [{ applicationId, expectedReviewVersion: reviewVersion }] }, { key: `b-${round}` }),
        ]);
        const row = rowOf(many.res, applicationId);
        const singleOk = !single.err;
        expect(singleOk !== row.success).toBe(true); // exactly one of them decided
        if (!singleOk) expect(single.err.status).toBe(409);
        if (!row.success) expect(row.httpStatus).toBe(409);
        expect(stripeCaptures - before).toBe(1);
        expect(await profilesWithEmail(email)).toBe(1);
        expect((await app(applicationId)).applicationStatus).toBe("processed");
      }
    });

    test("bulk approves a LINKED review into the linked profile, not by applicant email", async () => {
      const { applicationId, profileId } = await linkedApplication();
      const profilesBefore = await Profile.collection.countDocuments({ tenantId: T });
      const { res } = await bulk({ applicationIds: [applicationId] });
      expect(rowOf(res, applicationId)).toMatchObject({ success: true, profileId });
      expect(String((await app(applicationId)).profileId)).toBe(profileId);
      // approved into the linked profile: no profile created for the applicant's (different) email
      expect(await Profile.collection.countDocuments({ tenantId: T })).toBe(profilesBefore);
      expect(stripeCaptures).toBe(1);
    });

    test("bulk Create New with an email a profile already holds: row 409 PROFILE_EMAIL_EXISTS, no capture", async () => {
      const { applicationId } = await reviewedApplication();
      const email = (await app(applicationId)).contactInfo.personalEmail;
      await seedProfile({ email, mobile: `+35382${uid().slice(0, 7)}` }); // taken after the decision
      const { res } = await bulk({ applicationIds: [applicationId] });
      expect(rowOf(res, applicationId)).toMatchObject({ success: false, code: "PROFILE_EMAIL_EXISTS" });
      expect(post).not.toHaveBeenCalled();
      expect((await app(applicationId)).paymentDecision).toBeUndefined();
    });

    test("items must name listed applications", async () => {
      const { applicationId } = await reviewedApplication();
      const { err } = await bulk({ applicationIds: [applicationId], items: [{ applicationId: "other", expectedReviewVersion: 1 }] });
      expect(err).toMatchObject({ status: 400, code: "BULK_ITEMS_MISMATCH" });
      expect(post).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------- ownership

  describe("ownership on every decision path", () => {
    test("cross-tenant application: approve, reject, bulk, legacy and review decision all 404, nothing called", async () => {
      const { applicationId } = await reviewedApplication(); // tenant T
      const other = { tenantId: T2 };
      const a = await approve(applicationId, other);
      expect(a.err).toMatchObject({ status: 404 });
      const r = await reject(applicationId, other);
      expect(r.err).toMatchObject({ status: 404 });
      const b = await bulk({ applicationIds: [applicationId] }, other);
      expect(rowOf(b.res, applicationId)).toMatchObject({ success: false, httpStatus: 404 });
      const l = await legacyStatus(applicationId, other);
      expect(l.res.statusCode).toBe(404);
      const dcs = await decide(applicationId, { action: "MARKED_NEW" }, other);
      expect(dcs.err).toMatchObject({ status: 404 });
      expect(post).not.toHaveBeenCalled();
      const after = await app(applicationId);
      expect(after.applicationStatus).toBe("submitted");
      expect(after.paymentDecision).toBeUndefined();
    });

    test("LINK target moved to another tenant: approve and bulk 404 MATCHED_PROFILE_NOT_FOUND before capture", async () => {
      const { applicationId, profileId } = await linkedApplication();
      await Profile.collection.updateOne({ _id: new mongoose.Types.ObjectId(profileId) }, { $set: { tenantId: T2 } });
      const single = await approve(applicationId);
      expect(single.err).toMatchObject({ status: 404, code: "MATCHED_PROFILE_NOT_FOUND" });
      const b = await bulk({ applicationIds: [applicationId] });
      expect(rowOf(b.res, applicationId)).toMatchObject({ success: false, code: "MATCHED_PROFILE_NOT_FOUND" });
      expect(post).not.toHaveBeenCalled();
      expect((await app(applicationId)).paymentDecision).toBeUndefined();
    });

    test("LINK target no longer a current match: approve 409 MATCH_NOT_CURRENT before capture", async () => {
      const { applicationId, profileId } = await linkedApplication();
      await PersonalDetails.collection.updateOne(
        { applicationId, "duplicateReview.matchSummary.sourceId": profileId },
        { $set: { "duplicateReview.matchSummary.$.ignored": true } },
      );
      const single = await approve(applicationId);
      expect(single.err).toMatchObject({ status: 409, code: "MATCH_NOT_CURRENT" });
      expect(post).not.toHaveBeenCalled();
    });

    test("payment bound to another application: 409 PAYMENT_APPLICATION_MISMATCH on every path, nothing captured or cancelled", async () => {
      const ids = [];
      for (let i = 0; i < 4; i++) ids.push((await reviewedApplication()).applicationId);
      latestOverride = (id) => ({ paymentIntentId: `pi_${id}`, id: "d00000000000000000000003", attemptNumber: 1, applicationId: "someone-else" });
      const a = await approve(ids[0]);
      expect(a.err).toMatchObject({ status: 409, code: "PAYMENT_APPLICATION_MISMATCH" });
      const r = await reject(ids[1]);
      expect(r.err).toMatchObject({ status: 409, code: "PAYMENT_APPLICATION_MISMATCH" });
      const b = await bulk({ applicationIds: [ids[2]] });
      expect(rowOf(b.res, ids[2])).toMatchObject({ success: false, code: "PAYMENT_APPLICATION_MISMATCH" });
      const l = await legacyStatus(ids[3]);
      expect(l.err).toMatchObject({ status: 409, code: "PAYMENT_APPLICATION_MISMATCH" });
      expect(post).not.toHaveBeenCalled();
      for (const id of ids) {
        const doc = await app(id);
        expect(doc.applicationStatus).toBe("submitted");
        expect(doc.paymentDecision).toBeUndefined(); // claim never taken or released
      }
    });

    test("missing binding: no account record (only a stored local intent) or a record without applicationId -> 409 PAYMENT_BINDING_MISSING", async () => {
      const a1 = (await reviewedApplication()).applicationId;
      const a2 = (await reviewedApplication()).applicationId;
      latestOverride = () => null; // account 404: only SubscriptionDetails.paymentDetails has an intent
      const first = await approve(a1);
      expect(first.err).toMatchObject({ status: 409, code: "PAYMENT_BINDING_MISSING" });
      const firstReject = await reject(a1);
      expect(firstReject.err).toMatchObject({ status: 409, code: "PAYMENT_BINDING_MISSING" });
      latestOverride = (id) => ({ paymentIntentId: `pi_${id}`, id: "d00000000000000000000005", attemptNumber: 1 });
      const second = await approve(a2);
      expect(second.err).toMatchObject({ status: 409, code: "PAYMENT_BINDING_MISSING" });
      const b = await bulk({ applicationIds: [a2] });
      expect(rowOf(b.res, a2)).toMatchObject({ success: false, code: "PAYMENT_BINDING_MISSING" });
      expect(post).not.toHaveBeenCalled();
      expect((await app(a1)).paymentDecision).toBeUndefined();
      expect((await app(a2)).paymentDecision).toBeUndefined();
    });

    test("an application with no payment at all is still approvable (nothing to bind)", async () => {
      const { applicationId } = await reviewedApplication();
      await SubscriptionDetails.collection.updateOne({ applicationId }, { $unset: { paymentDetails: "" } });
      latestOverride = () => null;
      const res = await approve(applicationId);
      expect(res.err).toBeUndefined();
      expect(post).not.toHaveBeenCalled();
      expect((await app(applicationId)).applicationStatus).toBe("processed");
    });
  });

  // ---------------------------------------------------------------- version mode

  describe("DUPLICATE_REVIEW_VERSION_MODE", () => {
    test("compat (default): no key / no version still decides; a stale sent version is 409 with no claim", async () => {
      const { applicationId, reviewVersion } = await reviewedApplication();
      const stale = await approve(applicationId, { body: { expectedReviewVersion: reviewVersion + 1 } });
      expect(stale.err).toMatchObject({ status: 409, code: "REVIEW_VERSION_CONFLICT" });
      expect((await app(applicationId)).paymentDecision).toBeUndefined();
      const ok = await approve(applicationId);
      expect(ok.err).toBeUndefined();
      expect(stripeCaptures).toBe(1);
    });

    test("compat: malformed key or version is 400 with an explicit code", async () => {
      const { applicationId } = await reviewedApplication();
      const badVersion = await approve(applicationId, { body: { expectedReviewVersion: "1" } });
      expect(badVersion.err).toMatchObject({ status: 400, code: "REVIEW_VERSION_INVALID" });
      const badKey = await approve(applicationId, { key: "has space" });
      expect(badKey.err).toMatchObject({ status: 400, code: "IDEMPOTENCY_KEY_INVALID" });
      expect(post).not.toHaveBeenCalled();
    });

    test("an unrecognised mode value behaves as compat", async () => {
      process.env[MODE] = "enforced"; // typo must not block approvals
      const { applicationId } = await reviewedApplication();
      const ok = await approve(applicationId);
      expect(ok.err).toBeUndefined();
    });

    test("enforce: approve needs Idempotency-Key and expectedReviewVersion (428), then decides", async () => {
      process.env[MODE] = "enforce";
      const { applicationId, reviewVersion } = await reviewedApplication();
      const noKey = await approve(applicationId, { body: { expectedReviewVersion: reviewVersion } });
      expect(noKey.err).toMatchObject({ status: 428, code: "IDEMPOTENCY_KEY_REQUIRED" });
      const noVersion = await approve(applicationId, { key: "k-approve-1" });
      expect(noVersion.err).toMatchObject({ status: 428, code: "REVIEW_VERSION_REQUIRED" });
      expect(post).not.toHaveBeenCalled();
      expect((await app(applicationId)).paymentDecision).toBeUndefined();
      const ok = await approve(applicationId, { key: "k-approve-1", body: { expectedReviewVersion: reviewVersion } });
      expect(ok.err).toBeUndefined();
      expect(stripeCaptures).toBe(1);
    });

    test("enforce: duplicate-review decision, reject, bulk and legacy preconditions", async () => {
      process.env[MODE] = "enforce";
      // duplicate-review decision
      const mobile = `+35381${uid().slice(0, 7)}`;
      await seedApplication({ mobile });
      const pending = await seedApplication({ mobile });
      await detection.detectDuplicates(pending, T);
      const v = await version(pending);
      const d1 = await decide(pending, { action: "MARKED_NEW" }, { key: "k-dec-1" });
      expect(d1.err).toMatchObject({ status: 428, code: "REVIEW_VERSION_REQUIRED" });
      const d2 = await decide(pending, { action: "MARKED_NEW", expectedReviewVersion: v });
      expect(d2.err).toMatchObject({ status: 428, code: "IDEMPOTENCY_KEY_REQUIRED" });
      expect(await version(pending)).toBe(v); // nothing written
      const d3 = await decide(pending, { action: "MARKED_NEW", expectedReviewVersion: v }, { key: "k-dec-1" });
      expect(d3.err).toBeUndefined();

      // reject: key required, version optional
      const { applicationId: toReject } = await reviewedApplication();
      const r1 = await reject(toReject);
      expect(r1.err).toMatchObject({ status: 428, code: "IDEMPOTENCY_KEY_REQUIRED" });
      const r2 = await reject(toReject, { key: "k-rej-1" });
      expect(r2.err).toBeUndefined();
      expect(stripeCancels).toBe(1);

      // bulk: key required for the request; each row needs its version
      const withV = await reviewedApplication();
      const withoutV = await reviewedApplication();
      const b0 = await bulk({ applicationIds: [withV.applicationId] });
      expect(b0.err).toMatchObject({ status: 428, code: "IDEMPOTENCY_KEY_REQUIRED" });
      const b1 = await bulk(
        {
          applicationIds: [withV.applicationId, withoutV.applicationId],
          items: [{ applicationId: withV.applicationId, expectedReviewVersion: withV.reviewVersion }],
        },
        { key: "k-bulk-1" },
      );
      expect(rowOf(b1.res, withV.applicationId)).toMatchObject({ success: true });
      expect(rowOf(b1.res, withoutV.applicationId)).toMatchObject({ success: false, code: "REVIEW_VERSION_REQUIRED", httpStatus: 428 });
      expect(captured.has(`pi_${withoutV.applicationId}`)).toBe(false);

      // legacy status route
      const { applicationId: viaLegacy, reviewVersion: lv } = await reviewedApplication();
      const l1 = await legacyStatus(viaLegacy, { key: "k-leg-1" });
      expect(l1.err).toMatchObject({ status: 428, code: "REVIEW_VERSION_REQUIRED" });
      const l2 = await legacyStatus(viaLegacy, { body: { expectedReviewVersion: lv } });
      expect(l2.err).toMatchObject({ status: 428, code: "IDEMPOTENCY_KEY_REQUIRED" });
      const l3 = await legacyStatus(viaLegacy, { key: "k-leg-1", body: { expectedReviewVersion: lv } });
      expect(l3.err).toBeUndefined();
      expect((await app(viaLegacy)).applicationStatus).toBe("processed");
    });

    test("Idempotency-Key replay: the same key after completion returns the recorded outcome; a new key is 409", async () => {
      const { applicationId, reviewVersion } = await reviewedApplication();
      const body = { expectedReviewVersion: reviewVersion };
      const first = await approve(applicationId, { key: "k-replay-1", body });
      expect(first.err).toBeUndefined();
      const again = await approve(applicationId, { key: "k-replay-1", body });
      expect(again.err).toBeUndefined();
      expect(again.res.body).toMatchObject({ applicationId, status: "processed", replayed: true, profileId: first.res.body.profileId });
      const other = await approve(applicationId, { key: "k-replay-2", body });
      expect(other.err).toMatchObject({ status: 409, code: "APPLICATION_ALREADY_DECIDED" });
      expect(stripeCaptures).toBe(1);
      // a bulk retry carrying the same key replays that row too
      const b = await bulk({ applicationIds: [applicationId] }, { key: "k-replay-1" });
      expect(rowOf(b.res, applicationId)).toMatchObject({ success: true, replayed: true });
      expect(stripeCaptures).toBe(1);
    });
  });
});

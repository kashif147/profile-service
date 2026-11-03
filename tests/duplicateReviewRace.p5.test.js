"use strict";
/**
 * P5: duplicate-review decisions vs background re-detection vs approval, on a REAL MongoDB replica
 * set (transactions, write conflicts and findOneAndUpdate atomicity are the database's). Skipped
 * unless P5_DUPREVIEW_MONGO_URI is set (a disposable replica set; never a shared database).
 *
 * Proves:
 *  - Create New Profile survives background re-detection; a LINK survives unchanged-input re-detection;
 *  - a material applicant change invalidates the decision (fresh review, version bumped);
 *  - a stale cached decision cannot report false success; stale expectedReviewVersion -> 409;
 *  - concurrent detection and approval stay consistent;
 *  - a failed duplicate gate makes no capture call and takes no claim;
 *  - capture success then a persistence failure recovers with ONE capture and ONE profile;
 *  - concurrent approvals create ONE profile and capture once;
 *  - wrong-tenant / non-match LINK is denied; Create New with an email already on a profile is refused.
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

d("duplicate review race (real replica set)", () => {
  let mongoose;
  let axios;
  let PersonalDetails;
  let ProfessionalDetails;
  let SubscriptionDetails;
  let Profile;
  let detection;
  let review;
  let profileApproval;
  let reviewController;
  let idem;
  let mockRes;
  const T = "a1b2c3d4e5f6a7b8c9d0e1f2";
  const T2 = "b1b2c3d4e5f6a7b8c9d0e1f2";
  const ACTOR = "c00000000000000000000001";
  // fake account/Stripe: capture is idempotent per PaymentIntent
  let stripeCaptures;
  let captured;
  let post;

  beforeAll(async () => {
    process.env.ACCOUNT_PAYMENT_COMMAND_MODE = "bound";
    process.env.ACCOUNT_SERVICE_URL = "http://account-service:4000";
    mongoose = require("mongoose");
    axios = require("axios");
    await mongoose.connect(URI);
    PersonalDetails = require("../models/personal.details.model.js");
    ProfessionalDetails = require("../models/professional.details.model.js");
    SubscriptionDetails = require("../models/subscription.model.js");
    Profile = require("../models/profile.model.js");
    require("../models/user.model.js");
    // Model.init() trips over a pre-existing duplicate index declaration; build only what the
    // invariants under test rely on (profiles unique per tenant+email, as in production).
    await Promise.all([PersonalDetails, ProfessionalDetails, SubscriptionDetails, Profile].map((M) => M.init().catch(() => {})));
    await Profile.collection.createIndex({ tenantId: 1, normalizedEmail: 1 }, { unique: true, name: "p5_tenant_email_unique" }).catch(() => {});
    detection = require("../services/duplicate.detection.service.js");
    review = require("../services/duplicate.review.service.js");
    profileApproval = require("../controllers/profileApproval.controller.js");
    reviewController = require("../controllers/duplicateReview.controller.js");
    idem = require("../services/reviewDecisionIdempotency.js");
    ({ mockRes } = require("./helpers/memoryModel"));
  });

  afterAll(async () => {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    idem._reset();
    stripeCaptures = 0;
    captured = new Set();
    post = jest.spyOn(axios, "post").mockImplementation(async (url) => {
      const pi = url.split("/intents/")[1].split("/")[0];
      await new Promise((r) => setTimeout(r, 15)); // network latency: widens race windows
      if (url.endsWith("/capture")) {
        if (captured.has(pi)) return { status: 200, data: { data: { alreadyCaptured: true } } };
        captured.add(pi);
        stripeCaptures += 1;
        return { status: 200, data: { data: { captured: true } } };
      }
      return { status: 200, data: { data: { canceled: true } } };
    });
    jest.spyOn(axios, "get").mockImplementation(async (url) => {
      const id = decodeURIComponent(url.split("/applications/")[1].split("/")[0]);
      return { status: 200, data: { data: { paymentIntentId: `pi_${id}`, id: "d00000000000000000000001", attemptNumber: 1 } } };
    });
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  const uid = () => crypto.randomBytes(6).toString("hex");

  async function seedApplication({ tenantId = T, email, mobile, forename = "Pat", surname = "Race" } = {}) {
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

  async function seedProfile({ tenantId = T, email, mobile, forename = "Pat", surname = "Race" }) {
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
  const profilesWithEmail = (email) => Profile.collection.countDocuments({ tenantId: T, normalizedEmail: email.toLowerCase() });

  const crmReq = (extra = {}) => ({
    tenantId: T,
    ctx: { tenantId: T },
    user: { id: ACTOR, userType: "CRM", tenantId: T },
    userId: ACTOR,
    headers: { "x-correlation-id": "corr-race" },
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

  const approve = (applicationId) =>
    invoke(profileApproval.approveApplication, crmReq({ params: { applicationId }, body: { submission: {} } }));

  async function decide(applicationId, body, key) {
    const req = crmReq({ params: { applicationId }, body });
    if (key) req.headers["idempotency-key"] = key;
    return invoke(reviewController.submitDuplicateReviewDecision, req);
  }

  // An application that matches another SUBMITTED application on mobile (not a profile): a real
  // POTENTIAL_MATCH for which Create New Profile is a legitimate decision.
  async function potentialMatchPair() {
    const mobile = `+35386${uid().slice(0, 7)}`;
    const other = await seedApplication({ mobile });
    const applicationId = await seedApplication({ mobile });
    await detection.detectDuplicates(applicationId, T);
    const a = await app(applicationId);
    expect(a.duplicateReview.status).toBe("POTENTIAL_MATCH");
    return { applicationId, other, mobile };
  }

  test("Create New Profile survives background re-detection (unchanged input)", async () => {
    const { applicationId } = await potentialMatchPair();
    const v0 = (await app(applicationId)).duplicateReview.reviewVersion;
    const { res, err } = await decide(applicationId, { action: "MARKED_NEW", expectedReviewVersion: v0 });
    expect(err).toBeUndefined();
    expect(res.body.data.reviewVersion).toBe(v0 + 1);
    for (let i = 0; i < 3; i++) {
      const out = await detection.detectDuplicates(applicationId, T); // background run (e.g. payment event)
      expect(out.preservedDecision).toBe(true);
    }
    const after = await app(applicationId);
    expect(after.duplicateReview.status).toBe("MARKED_NEW");
    expect(after.duplicateReview.reviewVersion).toBe(v0 + 1);
  });

  test("LINK survives unchanged-input re-detection", async () => {
    const mobile = `+35385${uid().slice(0, 7)}`;
    const profileId = await seedProfile({ email: `${uid()}@member.test`, mobile });
    const applicationId = await seedApplication({ mobile });
    await detection.detectDuplicates(applicationId, T);
    const v = (await app(applicationId)).duplicateReview.reviewVersion;
    const { err } = await decide(applicationId, { action: "LINK", sourceType: "PROFILE", sourceId: profileId, expectedReviewVersion: v });
    expect(err).toBeUndefined();
    await detection.detectDuplicates(applicationId, T);
    await detection.detectDuplicates(applicationId, T);
    const after = await app(applicationId);
    expect(after.duplicateReview.status).toBe("LINKED");
    expect(String(after.duplicateReview.matchedProfileId)).toBe(profileId);
  });

  test("a material applicant change invalidates the decision and requires a fresh review", async () => {
    const { applicationId } = await potentialMatchPair();
    await decide(applicationId, { action: "MARKED_NEW" });
    const v1 = (await app(applicationId)).duplicateReview.reviewVersion;
    await PersonalDetails.collection.updateOne({ applicationId }, { $set: { "contactInfo.mobileNumber": "+353870000001" } });
    const out = await detection.detectDuplicates(applicationId, T);
    expect(out.invalidatedDecision).toBe(true);
    const after = await app(applicationId);
    expect(["POTENTIAL_MATCH", "NO_MATCH"]).toContain(after.duplicateReview.status);
    expect(after.duplicateReview.reviewVersion).toBe(v1 + 1);
    expect(after.duplicateReview.auditHistory.map((h) => h.action)).toContain("INVALIDATED_INPUT_CHANGED");
  });

  test("stale cached decision cannot report false success; key reuse and stale version are refused", async () => {
    const { applicationId } = await potentialMatchPair();
    const v0 = (await app(applicationId)).duplicateReview.reviewVersion;
    const body = { action: "MARKED_NEW", expectedReviewVersion: v0 };
    const first = await decide(applicationId, body, "op-1");
    expect(first.err).toBeUndefined();
    // identical retry while the review is unchanged -> original result
    const replay = await decide(applicationId, body, "op-1");
    expect(replay.err).toBeUndefined();
    expect(replay.res.body.data.replayed).toBe(true);
    expect(replay.res.body.data.reviewVersion).toBe(v0 + 1);
    // same key, different payload -> 422
    const reused = await decide(applicationId, { action: "MARKED_NEW", decisionReason: "x", expectedReviewVersion: v0 }, "op-1");
    expect(reused.err).toMatchObject({ status: 422, code: "IDEMPOTENCY_KEY_REUSED" });
    // the review changes (input changed -> invalidated)
    await PersonalDetails.collection.updateOne({ applicationId }, { $set: { "contactInfo.mobileNumber": "+353870000002" } });
    await detection.detectDuplicates(applicationId, T);
    const stale = await decide(applicationId, body, "op-1");
    expect(stale.err).toMatchObject({ status: 409, code: "REVIEW_VERSION_CONFLICT" });
    // a new decision against the stale version -> 409, nothing written
    const before = await app(applicationId);
    const staleNew = await decide(applicationId, body, "op-2");
    expect(staleNew.err).toMatchObject({ status: 409, code: "REVIEW_VERSION_CONFLICT" });
    expect((await app(applicationId)).duplicateReview.reviewVersion).toBe(before.duplicateReview.reviewVersion);
  });

  test("failed duplicate gate: no claim, no capture call", async () => {
    const { applicationId } = await potentialMatchPair();
    const { err } = await approve(applicationId);
    expect(err).toMatchObject({ status: 422, code: "DUPLICATE_REVIEW_REQUIRED" });
    expect(post).not.toHaveBeenCalled();
    expect((await app(applicationId)).paymentDecision).toBeUndefined();
  });

  test("approval after Create New Profile: one capture, one new profile, decision recorded", async () => {
    const { applicationId } = await potentialMatchPair();
    await decide(applicationId, { action: "MARKED_NEW" });
    const a = await app(applicationId);
    const { err, res } = await approve(applicationId);
    expect(err).toBeUndefined();
    expect(res.statusCode).toBe(200);
    expect(stripeCaptures).toBe(1);
    const after = await app(applicationId);
    expect(after.applicationStatus).toBe("processed");
    expect(after.paymentDecision.reviewVersion).toBe(a.duplicateReview.reviewVersion);
    expect(await profilesWithEmail(a.contactInfo.personalEmail)).toBe(1);
  });

  test("concurrent background detection and approval stay consistent", async () => {
    for (let round = 0; round < 8; round++) {
      const { applicationId } = await potentialMatchPair();
      await decide(applicationId, { action: "MARKED_NEW" });
      const changeInput = round % 2 === 1; // odd rounds: a material change races the approval
      if (changeInput) {
        await PersonalDetails.collection.updateOne({ applicationId }, { $set: { "contactInfo.mobileNumber": `+35388${uid().slice(0, 7)}` } });
      }
      const [appr] = await Promise.all([
        approve(applicationId),
        detection.detectDuplicates(applicationId, T).catch((e) => e),
        detection.detectDuplicates(applicationId, T).catch((e) => e),
      ]);
      const after = await app(applicationId);
      if (after.applicationStatus === "processed") {
        // approved: committed against the decision it passed, which was not invalidated underneath it
        expect(appr.err).toBeUndefined();
        expect(after.duplicateReview.status).toBe("MARKED_NEW");
        expect(after.paymentDecision.reviewVersion).toBe(after.duplicateReview.reviewVersion);
      } else {
        // not approved: an explicit review-changed / review-required outcome, never a silent success
        expect(appr.err?.code).toMatch(/^(REVIEW_CHANGED|REVIEW_CHANGED_AFTER_CAPTURE|DUPLICATE_REVIEW_REQUIRED)$/);
        if (appr.err.code === "REVIEW_CHANGED_AFTER_CAPTURE") {
          expect(after.paymentDecision.action).toBe("approve"); // captured: claim kept, never released
        }
      }
      if (!changeInput) {
        expect(after.applicationStatus).toBe("processed"); // unchanged input never blocks approval
      }
    }
  });

  test("capture succeeds then persistence fails: re-approve completes with one capture and one profile", async () => {
    const { applicationId } = await potentialMatchPair();
    await decide(applicationId, { action: "MARKED_NEW" });
    const email = (await app(applicationId)).contactInfo.personalEmail;
    const realFoU = SubscriptionDetails.findOneAndUpdate.bind(SubscriptionDetails);
    const spy = jest.spyOn(SubscriptionDetails, "findOneAndUpdate").mockImplementationOnce(() => {
      throw new Error("simulated persistence failure after capture");
    });
    const first = await approve(applicationId);
    expect(first.err).toBeDefined();
    expect(stripeCaptures).toBe(1);
    let a = await app(applicationId);
    expect(a.applicationStatus).toBe("submitted");
    expect(a.paymentDecision.action).toBe("approve"); // money moved: claim kept
    expect(a.paymentDecision.leaseUntil).toBeUndefined(); // lease ended: re-run can start now
    expect(await profilesWithEmail(email)).toBe(0); // aborted transaction left no profile
    // the opposite decision stays blocked
    const rej = await invoke(profileApproval.rejectApplication, crmReq({ params: { applicationId }, body: { reason: "x" } }));
    expect(rej.err).toMatchObject({ status: 409, code: "PAYMENT_DECISION_CONFLICT" });
    spy.mockImplementation(realFoU);
    const second = await approve(applicationId);
    expect(second.err).toBeUndefined();
    expect(stripeCaptures).toBe(1); // replayed as already captured
    a = await app(applicationId);
    expect(a.applicationStatus).toBe("processed");
    expect(await profilesWithEmail(email)).toBe(1);
  });

  test("concurrent approvals: one profile, one capture", async () => {
    for (let round = 0; round < 6; round++) {
      const { applicationId } = await potentialMatchPair();
      await decide(applicationId, { action: "MARKED_NEW" });
      const email = (await app(applicationId)).contactInfo.personalEmail;
      const before = stripeCaptures;
      const results = await Promise.all([approve(applicationId), approve(applicationId), approve(applicationId)]);
      const ok = results.filter((r) => !r.err);
      expect(ok).toHaveLength(1);
      for (const r of results.filter((x) => x.err)) {
        expect(r.err.status).toBe(409);
      }
      expect(stripeCaptures - before).toBe(1);
      expect(await profilesWithEmail(email)).toBe(1);
      expect((await app(applicationId)).applicationStatus).toBe("processed");
    }
  });

  test("a second approve run cannot release the claim another run is acting on (#50 interaction)", async () => {
    const { applicationId } = await potentialMatchPair();
    await decide(applicationId, { action: "MARKED_NEW" });
    const decision = require("../services/applicationPaymentDecision.service.js");
    // run A holds the approve claim (its capture is in flight)
    const held = await decision.claimPaymentDecision({ applicationId, tenantId: T, action: "approve", actorUserId: ACTOR });
    // run B fails before any capture (forced: the latest-payment lookup is down)
    jest.spyOn(axios, "get").mockImplementationOnce(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    });
    await approve(applicationId);
    const a = await app(applicationId);
    expect(a.paymentDecision?.action).toBe("approve");
    expect(a.paymentDecision?.claimId).toBe(held.claimId); // B did not release A's claim
  });

  test("LINK to another tenant's profile or a non-match is denied; Create New with a taken email is refused", async () => {
    const mobile = `+35384${uid().slice(0, 7)}`;
    const foreign = await seedProfile({ tenantId: T2, email: `${uid()}@other.test`, mobile });
    const unrelated = await seedProfile({ email: `${uid()}@member.test`, mobile: `+35383${uid().slice(0, 7)}`, forename: "Zed", surname: "Other" });
    const applicationId = await seedApplication({ mobile });
    await detection.detectDuplicates(applicationId, T);
    const wrongTenant = await decide(applicationId, { action: "LINK", sourceType: "PROFILE", sourceId: foreign });
    expect(wrongTenant.err).toMatchObject({ status: 404, code: "MATCHED_PROFILE_NOT_FOUND" });
    const notMatch = await decide(applicationId, { action: "LINK", sourceType: "PROFILE", sourceId: unrelated });
    expect(notMatch.err).toMatchObject({ status: 409, code: "MATCH_NOT_CURRENT" });
    expect((await app(applicationId)).duplicateReview.status).not.toBe("LINKED");

    // Create New Profile when a profile already holds the applicant's email: refused at decision time
    const email = `${uid()}@taken.test`;
    await seedProfile({ email, mobile: `+35382${uid().slice(0, 7)}` });
    const taken = await seedApplication({ email });
    await detection.detectDuplicates(taken, T);
    const res = await decide(taken, { action: "MARKED_NEW" });
    expect(res.err).toMatchObject({ status: 409, code: "PROFILE_EMAIL_EXISTS" });
  });
});

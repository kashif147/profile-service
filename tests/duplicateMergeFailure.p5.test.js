"use strict";
/**
 * P5 duplicate merge: what happens when a downstream reassignment fails AFTER the profile-service writes commit.
 *
 * REAL executeProfileDuplicateMerge + REAL profile.merge.consolidation.service; in-memory profile store, recorded
 * reference updates, stubbed subscription-service / account-service clients and audit publisher (no DB, no network).
 *   - subscription OR finance failure (non-2xx Error, or timeout) -> 502 PROFILE_MERGE_INCOMPLETE {failedStep,
 *     retryable, localMergeCommitted}; the transaction is committed once and never aborted; no audit event.
 *   - re-running the SAME (keeper, absorbed) pair resumes: every step runs again idempotently and completes.
 *   - a partially merged profile cannot be merged into a DIFFERENT keeper (409 PROFILE_ALREADY_MERGED, no writes);
 *     a keeper that was itself merged away is refused (409 MERGE_KEEPER_ALREADY_MERGED).
 *   - the downstream calls are bound to the merge's tenant and pair; the subscription call is a pure internal
 *     call (no user identity), so the caller needs NO subscriptions:* claim.
 */
const mongoose = require("mongoose");

const TENANT = "aaaaaaaaaaaaaaaaaaaaaaaa";
const M = "6a4d47f7c060a977a3b332ef"; // keeper
const A = "6a4d47f7c060a977a3b332ee"; // absorbed
const X = "6a4d47f7c060a977a3b332ed"; // another keeper

const mockStore = { profiles: {}, refUpdates: [] };
const clone = (o) => JSON.parse(JSON.stringify(o));
const mockFind = (filter) => {
  const p = mockStore.profiles[String(filter._id)];
  const out = p && p.tenantId === filter.tenantId ? { ...clone(p), _id: new (require("mongoose").Types.ObjectId)(String(filter._id)) } : null;
  return { lean: async () => out, session: async () => out };
};
const mockApplySet = (filter, update) => {
  const p = mockStore.profiles[String(filter._id)];
  if (!p || p.tenantId !== filter.tenantId) return { matchedCount: 0, modifiedCount: 0 };
  for (const [k, v] of Object.entries((update && update.$set) || {})) p[k] = v && v.toString && v._bsontype ? String(v) : v;
  return { matchedCount: 1, modifiedCount: 1 };
};
const mockRecordUpdateMany = (model) => async (filter) => {
  mockStore.refUpdates.push({ model, tenantId: filter.tenantId });
  return { modifiedCount: 0 };
};

jest.mock("../models/profile.model.js", () => ({
  findOne: (f) => mockFind(f),
  updateOne: async (f, u) => mockApplySet(f, u),
  updateMany: mockRecordUpdateMany("Profile"),
}));
jest.mock("../models/personal.details.model.js", () => ({ updateMany: mockRecordUpdateMany("PersonalDetails") }));
jest.mock("../models/memberPaymentForm.model.js", () => ({ MemberPaymentForm: { updateMany: mockRecordUpdateMany("MemberPaymentForm") } }));
jest.mock("../models/transfer.request.model.js", () => ({ updateMany: mockRecordUpdateMany("TransferRequest") }));
jest.mock("../models/batch.model.js", () => ({ updateMany: mockRecordUpdateMany("Batch") }));
jest.mock("../models/professional.details.model.js", () => ({}));
jest.mock("../models/subscription.model.js", () => ({}));
jest.mock("../services/submission.service.js", () => ({ loadSubmission: jest.fn() }));
jest.mock("../services/duplicate.matching.js", () => ({ findAuthorizedProfileMatch: jest.fn() }));
jest.mock("../services/subscription.service.client.js", () => ({
  fetchCurrentSubscriptionByProfileId: jest.fn(async () => null),
  reassignSubscriptionsForProfileMerge: jest.fn(),
}));
jest.mock("../services/account.service.client.js", () => ({
  fetchMemberFinanceSummary: jest.fn(),
  reassignFinanceForProfileMerge: jest.fn(),
}));
jest.mock("../services/profile.duplicate.audit.publisher.js", () => ({ publishProfileDuplicateMergedAudit: jest.fn() }));

const { executeProfileDuplicateMerge } = require("../services/duplicate.merge.service.js");
const { reassignSubscriptionsForProfileMerge } = require("../services/subscription.service.client.js");
const { reassignFinanceForProfileMerge } = require("../services/account.service.client.js");
const { publishProfileDuplicateMergedAudit } = require("../services/profile.duplicate.audit.publisher.js");

const baseProfile = (n) => ({
  tenantId: TENANT,
  membershipNumber: n,
  isActive: true,
  personalInfo: { forename: n, surname: "Member" },
  contactInfo: {},
  professionalDetails: {},
  preferences: {},
  cornMarket: {},
  additionalInformation: {},
  recruitmentDetails: {},
});

let session;
const run = (master = M, absorbed = A) =>
  executeProfileDuplicateMerge({ masterProfileId: master, absorbedProfileId: absorbed, tenantId: TENANT, mergeFieldChoices: { "personalInfo.forename": "PROFILE" }, reviewerId: "reviewer-1" });

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.profiles = { [M]: baseProfile("M001"), [A]: baseProfile("M002"), [X]: baseProfile("M003") };
  mockStore.refUpdates = [];
  session = { startTransaction: jest.fn(), commitTransaction: jest.fn(async () => {}), abortTransaction: jest.fn(async () => {}), endSession: jest.fn() };
  jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
  reassignSubscriptionsForProfileMerge.mockResolvedValue({ subscriptionsMatched: 1, currentSubscriptionId: null });
  reassignFinanceForProfileMerge.mockResolvedValue({ paymentsUpdated: 1 });
  publishProfileDuplicateMergedAudit.mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

const httpError = (status) => Object.assign(new Error(`Downstream refused (${status})`), { status });
const timeoutError = () => Object.assign(new Error("timeout of 30000ms exceeded"), { code: "ECONNABORTED" });

describe("downstream failure after the profile-service commit", () => {
  test.each([
    ["subscription", "non-2xx", () => reassignSubscriptionsForProfileMerge.mockRejectedValueOnce(httpError(400))],
    ["subscription", "timeout", () => reassignSubscriptionsForProfileMerge.mockRejectedValueOnce(timeoutError())],
    ["finance", "non-2xx (e.g. 403 finance write)", () => reassignFinanceForProfileMerge.mockRejectedValueOnce(httpError(403))],
    ["finance", "timeout", () => reassignFinanceForProfileMerge.mockRejectedValueOnce(timeoutError())],
  ])("%s %s -> 502 PROFILE_MERGE_INCOMPLETE, local merge committed (not aborted), no audit, not a success", async (step, _kind, fail) => {
    fail();
    const err = await run().catch((e) => e);
    expect(err).toMatchObject({
      status: 502,
      code: "PROFILE_MERGE_INCOMPLETE",
      failedStep: step,
      retryable: true,
      localMergeCommitted: true,
      masterProfileId: M,
      absorbedProfileId: A,
    });
    expect(session.commitTransaction).toHaveBeenCalledTimes(1);
    expect(session.abortTransaction).not.toHaveBeenCalled();
    // observable committed state: absorbed deactivated and pointed at the keeper; references re-pointed in-tenant
    expect(mockStore.profiles[A]).toMatchObject({ isActive: false, mergedIntoProfileId: M });
    expect(mockStore.refUpdates.length).toBeGreaterThan(0);
    expect(mockStore.refUpdates.every((u) => u.tenantId === TENANT)).toBe(true);
    expect(publishProfileDuplicateMergedAudit).not.toHaveBeenCalled();
    // finance never runs after a subscription failure
    if (step === "subscription") expect(reassignFinanceForProfileMerge).not.toHaveBeenCalled();
  });

  test("re-running the SAME pair resumes and completes; downstream steps run again (idempotent) and the audit is published once", async () => {
    reassignFinanceForProfileMerge.mockRejectedValueOnce(httpError(503));
    await expect(run()).rejects.toMatchObject({ code: "PROFILE_MERGE_INCOMPLETE", failedStep: "finance" });
    const result = await run();
    expect(result).toMatchObject({ masterProfileId: M, absorbedProfileId: A });
    expect(reassignSubscriptionsForProfileMerge).toHaveBeenCalledTimes(2);
    expect(reassignFinanceForProfileMerge).toHaveBeenCalledTimes(2);
    expect(publishProfileDuplicateMergedAudit).toHaveBeenCalledTimes(1);
    expect(mockStore.profiles[A]).toMatchObject({ isActive: false, mergedIntoProfileId: M });
  });

  test("a partially merged profile cannot be merged into a DIFFERENT keeper: 409, no writes, transaction aborted", async () => {
    reassignSubscriptionsForProfileMerge.mockRejectedValueOnce(httpError(500));
    await expect(run(M, A)).rejects.toMatchObject({ code: "PROFILE_MERGE_INCOMPLETE" });
    const before = mockStore.refUpdates.length;
    const keeperBefore = clone(mockStore.profiles[X]);
    await expect(run(X, A)).rejects.toMatchObject({ status: 409, code: "PROFILE_ALREADY_MERGED" });
    expect(mockStore.refUpdates.length).toBe(before);
    expect(mockStore.profiles[X]).toEqual(keeperBefore);
    expect(mockStore.profiles[A].mergedIntoProfileId).toBe(M);
    expect(session.abortTransaction).toHaveBeenCalledTimes(1);
  });

  test("a keeper that was itself merged away is refused before any write", async () => {
    mockStore.profiles[M].mergedIntoProfileId = X;
    await expect(run(M, A)).rejects.toMatchObject({ status: 409, code: "MERGE_KEEPER_ALREADY_MERGED" });
    expect(mockStore.refUpdates).toHaveLength(0);
    expect(mockStore.profiles[A].mergedIntoProfileId).toBeUndefined();
  });

  test("a profile from another tenant is not found (no cross-tenant merge)", async () => {
    mockStore.profiles[A].tenantId = "bbbbbbbbbbbbbbbbbbbbbbbb";
    await expect(run(M, A)).rejects.toMatchObject({ status: 404 });
    expect(mockStore.refUpdates).toHaveLength(0);
    expect(reassignSubscriptionsForProfileMerge).not.toHaveBeenCalled();
  });
});

describe("downstream calls are bound to the merge (tenant + pair)", () => {
  test("both reassignments receive the merge's trusted tenant and the loaded (keeper, absorbed) ids and member numbers", async () => {
    await run();
    const expected = { tenantId: TENANT, masterProfileId: M, absorbedProfileId: A, masterMembershipNumber: "M001", absorbedMembershipNumber: "M002" };
    expect(reassignSubscriptionsForProfileMerge).toHaveBeenCalledWith(expect.objectContaining(expected));
    expect(reassignFinanceForProfileMerge).toHaveBeenCalledWith(expect.objectContaining(expected));
  });

  test("subscription call is a pure internal call: trusted tenant only, never the caller's identity or claims", () => {
    const { buildHeaders } = jest.requireActual("../services/subscription.service.client.js");
    const h = buildHeaders(TENANT);
    expect(h).toEqual({ "Content-Type": "application/json", "x-internal-request": "true", "x-tenant-id": TENANT });
  });

  test("OBSERVED GAP (documented, not fixed here): the finance call forwards the caller's identity, so account-service authorises it as the USER (requireFinanceWrite)", () => {
    const { buildHeaders } = jest.requireActual("../services/account.service.client.js");
    const h = buildHeaders({ headers: { authorization: "Bearer caller", "x-jwt-verified": "true" } }, TENANT);
    expect(h).toMatchObject({ "x-internal-request": "true", "x-tenant-id": TENANT, authorization: "Bearer caller" });
  });
});

"use strict";
/**
 * Phase 2B (C-04 / H-08) — Tenant A/B isolation for transfer requests and
 * Batch cohort snapshots. Real controllers, in-memory models.
 */
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.LOG_ROOT =
  process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-transfer-"));
process.env.NODE_ENV = process.env.NODE_ENV || "test";

jest.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));
const mm = () => require("./helpers/memoryModel");
jest.mock("../models/transfer.request.model", () => mm().createMemoryModel("TransferRequest"));
jest.mock("../models/profile.model", () => mm().createMemoryModel("Profile"));
jest.mock("../models/user.model", () => mm().createMemoryModel("User"));
jest.mock("../models/batch.model.js", () => mm().createMemoryModel("Batch"));
jest.mock("../rabbitMQ", () => ({ publishDomainEvent: jest.fn(), MEMBERSHIP_EVENTS: {} }));
jest.mock("../services/profile.audit.publisher.js", () => ({
  publishProfileAudit: jest.fn(async () => {}),
  cloneForAudit: (x) => JSON.parse(JSON.stringify(x)),
}));
jest.mock("axios", () => ({
  get: jest.fn(async () => ({ status: 200, data: {} })),
}));

const { mockRes } = require("./helpers/memoryModel");
const TransferRequest = require("../models/transfer.request.model");
const Profile = require("../models/profile.model");
const User = require("../models/user.model");
const Batch = require("../models/batch.model.js");
const transfer = require("../controllers/transfer.request.controller");
const batch = require("../controllers/batch.controller");

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const PA = "a00000000000000000000001";
const PB = "b00000000000000000000001";
const PORTAL_A = "a20000000000000000000001";
const PORTAL_B = "b20000000000000000000001";
const TR_A = "a30000000000000000000001";
const TR_B = "b30000000000000000000001";
const BATCH_B = "b40000000000000000000001";

const req = (tenantId, userType, extra = {}) => ({
  tenantId,
  ctx: { tenantId },
  user: { id: userType === "PORTAL" ? PORTAL_A : "crm-1", userType, tenantId },
  userId: userType === "PORTAL" ? PORTAL_A : "crm-1",
  headers: { authorization: "Bearer x" },
  params: {},
  query: {},
  body: {},
  ...extra,
});

async function invoke(fn, r) {
  const res = mockRes();
  let err;
  await fn(r, res, (e) => {
    err = e;
  });
  return { res, err };
}

beforeEach(() => {
  for (const M of [TransferRequest, Profile, User, Batch]) M.reset();
  Profile.seed([
    {
      _id: PA, tenantId: A, userId: PORTAL_A, isActive: true, batchId: null,
      professionalDetails: { workLocation: "Old A" },
      preferences: { valueAddedServices: true },
      additionalInformation: { membershipStatus: "new" },
      cornMarket: { inmoRewards: true },
    },
    {
      _id: PB, tenantId: B, userId: PORTAL_B, isActive: true, batchId: null,
      professionalDetails: { workLocation: "Old B" },
      preferences: { valueAddedServices: true },
      additionalInformation: { membershipStatus: "new" },
      cornMarket: { inmoRewards: true },
    },
  ]);
  TransferRequest.seed([
    { _id: TR_A, tenantId: A, userId: PORTAL_A, profileId: PA, currentWorkLocationId: "w1", requestedWorkLocationId: "w2", status: "PENDING" },
    { _id: TR_B, tenantId: B, userId: PORTAL_B, profileId: PB, currentWorkLocationId: "w1", requestedWorkLocationId: "w2", status: "PENDING" },
  ]);
});

describe("transfer requests (C-04)", () => {
  test("model has no hardcoded default tenant", () => {
    const realModel = jest.requireActual("../models/transfer.request.model");
    expect(realModel.schema.path("tenantId").defaultValue).toBeUndefined();
    const doc = new realModel({
      userId: PORTAL_A, profileId: PA, currentWorkLocationId: "w1", requestedWorkLocationId: "w2",
    });
    const errs = doc.validateSync();
    expect(errs && errs.errors.tenantId).toBeDefined();
  });

  test("create stamps the trusted tenant (body tenantId ignored)", async () => {
    TransferRequest.reset();
    const { res, err } = await invoke(
      transfer.submitTransferRequest,
      req(A, "PORTAL", {
        body: { tenantId: B, currentWorkLocationId: "w1", requestedWorkLocationId: "w2", reason: "move" },
      }),
    );
    expect(err).toBeUndefined();
    expect(res.statusCode).toBe(201);
    expect(TransferRequest.all()).toHaveLength(1);
    expect(TransferRequest.all()[0].tenantId).toBe(A);
  });

  test("CRM list for A only shows A's requests", async () => {
    const { res } = await invoke(transfer.getTransferRequestsForCRM, req(A, "CRM"));
    expect(res.body.data.map((r) => String(r._id))).toEqual([TR_A]);
  });

  test("portal user cannot use the CRM list", async () => {
    const { err } = await invoke(transfer.getTransferRequestsForCRM, req(A, "PORTAL"));
    expect(err && err.status).toBe(403);
  });

  test("A's CRM cannot approve B's request; B request + profile unchanged", async () => {
    const { res } = await invoke(
      transfer.reviewTransferRequest,
      req(A, "CRM", { params: { requestId: TR_B }, body: { action: "APPROVE" } }),
    );
    expect(res.statusCode).toBe(404);
    expect(TransferRequest.all().find((t) => t._id === TR_B).status).toBe("PENDING");
    expect(Profile.all().find((p) => p._id === PB).professionalDetails.workLocation).toBe("Old B");
  });

  test("a PORTAL user cannot approve even their own tenant's request", async () => {
    const { err } = await invoke(
      transfer.reviewTransferRequest,
      req(A, "PORTAL", { params: { requestId: TR_A }, body: { action: "APPROVE" } }),
    );
    expect(err && err.status).toBe(403);
    expect(TransferRequest.all().find((t) => t._id === TR_A).status).toBe("PENDING");
  });

  test("A's CRM can approve A's request", async () => {
    const { res } = await invoke(
      transfer.reviewTransferRequest,
      req(A, "CRM", { params: { requestId: TR_A }, body: { action: "REJECT" } }),
    );
    expect(res.statusCode).toBe(200);
    expect(TransferRequest.all().find((t) => t._id === TR_A).status).toBe("REJECTED");
  });
});

describe("batches (H-08)", () => {
  test("create in A only selects/stamps A profiles and stamps tenantId", async () => {
    const { res, err } = await invoke(
      batch.createBatch,
      req(A, "CRM", { body: { name: "b", type: "inmo-rewards", date: "2026-10-01", tenantId: B } }),
    );
    expect(err).toBeUndefined();
    expect(res.statusCode).toBe(201);
    const [saved] = Batch.all();
    expect(saved.tenantId).toBe(A);
    expect(saved.profileIds.map(String)).toEqual([PA]);
    expect(Profile.all().find((p) => p._id === PB).batchId).toBeNull();
  });

  test("B batch is invisible / immutable for A (get, update, delete, refresh)", async () => {
    Batch.seed([{ _id: BATCH_B, tenantId: B, name: "B", type: "inmo-rewards", isDeleted: false, isActive: true, profileIds: [PB], profiles: [], createdBy: "x" }]);
    Profile.store.find((p) => p._id === PB).batchId = BATCH_B;
    for (const fn of [batch.getBatchById, batch.updateBatch, batch.deleteBatch, batch.refreshBatch]) {
      const { err } = await invoke(fn, req(A, "CRM", { params: { batchId: BATCH_B }, body: { name: "hijack" } }));
      expect(err && err.status).toBe(404);
    }
    const b = Batch.all()[0];
    expect(b.name).toBe("B");
    expect(b.isDeleted).toBe(false);
    expect(Profile.all().find((p) => p._id === PB).batchId).toBe(BATCH_B);
  });

  test("list only returns the caller tenant's batches", async () => {
    Batch.seed([
      { tenantId: A, name: "A", type: "inmo-rewards", isDeleted: false, profileIds: [], createdBy: "x" },
      { tenantId: B, name: "B", type: "inmo-rewards", isDeleted: false, profileIds: [], createdBy: "x" },
    ]);
    const { res } = await invoke(batch.getAllBatches, req(B, "CRM"));
    expect(res.body.data.batches.map((x) => x.name)).toEqual(["B"]);
  });
});

describe("CRM profile lists (H-07): corn-market, recruit-a-friend, check-email, lookup-by-membership", () => {
  const cornMarket = require("../controllers/corn.market.controller");
  const recruit = require("../controllers/recruit.a.friend.controller");
  const profileController = require("../controllers/profile.controller");

  beforeEach(() => {
    Profile.store.find((p) => p._id === PA).recruitmentDetails = { confirmedRecruiterProfileId: PB };
    Profile.store.find((p) => p._id === PB).recruitmentDetails = { confirmedRecruiterProfileId: PA };
    Profile.store.find((p) => p._id === PA).normalizedEmail = "dup@example.com";
    Profile.store.find((p) => p._id === PB).normalizedEmail = "dup@example.com";
    Profile.store.find((p) => p._id === PA).membershipNumber = "M100-A";
    Profile.store.find((p) => p._id === PB).membershipNumber = "M100-B";
  });

  test("corn-market lists only the caller tenant's profiles", async () => {
    const { res } = await invoke(
      cornMarket.getCornMarketProfiles,
      req(A, "CRM", { query: { membershipStatus: "new", tenantId: B } }),
    );
    // Result rows are export snapshots (no _id); A's profile is M100-A.
    expect(res.body.data.results.map((p) => p.membershipNo)).toEqual(["M100-A"]);
  });

  test("recruit-a-friend lists only the caller tenant's profiles", async () => {
    const { res } = await invoke(recruit.getRecruitAFriendProfiles, req(B, "CRM"));
    expect(res.body.data.results.map((p) => String(p._id))).toEqual([PB]);
  });

  test("check-email never reveals another tenant's profile", async () => {
    Profile.store.find((p) => p._id === PA).normalizedEmail = "only-a@example.com";
    const { res } = await invoke(
      profileController.checkEmailExists,
      req(B, "CRM", { query: { email: "only-a@example.com" } }),
    );
    expect(res.body.data.exists).toBe(false);
  });

  test("lookup-by-membership is tenant-scoped and the diagnose path is not a cross-tenant oracle", async () => {
    // M100-A exists only in tenant A; tenant B asks for it.
    const { res } = await invoke(
      profileController.lookupProfilesByMembershipNumbers,
      req(B, "CRM", { body: { membershipNumbers: ["M100-A"], diagnose: true } }),
    );
    expect(res.body.data).toEqual([]);
    expect(res.body.lookupError).not.toMatch(/different tenant/);
  });

  test("lists require a trusted tenant", async () => {
    const { err } = await invoke(recruit.getRecruitAFriendProfiles, req(undefined, "CRM"));
    expect(err && err.status).toBe(403);
  });
});

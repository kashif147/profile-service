"use strict";
/**
 * P5 (subscription #30/#31 prerequisite): the batch create/refresh and legacy corn-market
 * subscription startDate lookups are internal-only service calls.
 *   - headers: x-internal-request + the VERIFIED tenant only; never Authorization / x-user-* /
 *     x-jwt-verified / x-auth-source, even when the inbound request carried them;
 *   - tenant from req.tenantId (verified), never the body/query;
 *   - SUBSCRIPTION_SERVICE_URL missing -> 503 SUBSCRIPTION_SERVICE_URL_REQUIRED, no request to any
 *     host (no external fallback), and nothing written (no batch, no profile batchId change).
 * Real controllers, in-memory models, axios mocked.
 */
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.LOG_ROOT =
  process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-p5-batchlookup-"));
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const mm = () => require("./helpers/memoryModel");
jest.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));
jest.mock("../models/profile.model", () => mm().createMemoryModel("Profile"));
jest.mock("../models/user.model", () => mm().createMemoryModel("User"));
jest.mock("../models/batch.model.js", () => mm().createMemoryModel("Batch"));
jest.mock("../rabbitMQ", () => ({ publishDomainEvent: jest.fn(), MEMBERSHIP_EVENTS: {} }));
jest.mock("../services/profile.audit.publisher.js", () => ({
  publishProfileAudit: jest.fn(async () => {}),
  cloneForAudit: (x) => JSON.parse(JSON.stringify(x)),
}));
jest.mock("axios", () => ({
  get: jest.fn(async () => ({ status: 200, data: { data: { startDate: "2026-01-01T00:00:00.000Z" } } })),
}));

const axios = require("axios");
const { mockRes } = require("./helpers/memoryModel");
const Profile = require("../models/profile.model");
const Batch = require("../models/batch.model.js");
const batch = require("../controllers/batch.controller");
const cornMarket = require("../controllers/corn.market.controller");

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const PA = "a00000000000000000000001";
const PB = "b00000000000000000000001";
const BATCH_A = "a40000000000000000000001";
const URL = "http://subscription-service.test";
const IDENTITY_HEADERS = {
  authorization: "Bearer sentinel-user-token",
  "x-jwt-verified": "true",
  "x-auth-source": "gateway",
  "x-user-id": "crm-1",
  "x-user-type": "CRM",
  "x-tenant-id": A,
};
const FORBIDDEN = ["authorization", "x-jwt-verified", "x-auth-source", "x-user-id", "x-user-type", "x-user-email", "x-user-roles", "x-user-permissions"];

const req = (tenantId, extra = {}) => ({
  tenantId,
  ctx: { tenantId },
  user: { id: "crm-1", userType: "CRM", tenantId },
  userId: "crm-1",
  headers: { ...IDENTITY_HEADERS },
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

function sentHeaders() {
  return axios.get.mock.calls.map((c) => Object.fromEntries(Object.entries(c[1].headers).map(([k, v]) => [k.toLowerCase(), v])));
}

beforeEach(() => {
  process.env.SUBSCRIPTION_SERVICE_URL = URL;
  axios.get.mockClear();
  for (const M of [Profile, Batch]) M.reset();
  Profile.seed([
    {
      _id: PA, tenantId: A, isActive: true, batchId: null, membershipNumber: "M-A",
      preferences: { valueAddedServices: true },
      additionalInformation: { membershipStatus: "new" },
      cornMarket: { inmoRewards: true },
    },
    {
      _id: PB, tenantId: B, isActive: true, batchId: null, membershipNumber: "M-B",
      preferences: { valueAddedServices: true },
      additionalInformation: { membershipStatus: "new" },
      cornMarket: { inmoRewards: true },
    },
  ]);
});

afterAll(() => {
  delete process.env.SUBSCRIPTION_SERVICE_URL;
});

function expectInternalOnly(tenant) {
  const hs = sentHeaders();
  expect(hs.length).toBeGreaterThan(0);
  for (const h of hs) {
    expect(h["x-internal-request"]).toBe("true");
    expect(h["x-tenant-id"]).toBe(tenant);
    for (const k of FORBIDDEN) expect(h[k]).toBeUndefined();
    expect(JSON.stringify(h)).not.toContain("sentinel-user-token");
  }
  for (const c of axios.get.mock.calls) expect(c[0].startsWith(`${URL}/api/v1/subscriptions/profile/`)).toBe(true);
}

describe("internal-only lookup headers, verified tenant", () => {
  test("createBatch", async () => {
    const { res, err } = await invoke(
      batch.createBatch,
      req(A, { body: { name: "b", type: "inmo-rewards", date: "2026-10-01", tenantId: B } }),
    );
    expect(err).toBeUndefined();
    expect(res.statusCode).toBe(201);
    expectInternalOnly(A);
    expect(axios.get.mock.calls.map((c) => c[0])).toEqual([`${URL}/api/v1/subscriptions/profile/${PA}/current`]);
  });

  test("refreshBatch", async () => {
    Batch.seed([{ _id: BATCH_A, tenantId: A, name: "A", type: "inmo-rewards", date: new Date("2026-10-01"), isDeleted: false, isActive: true, profileIds: [], profiles: [], createdBy: "x" }]);
    const { res, err } = await invoke(batch.refreshBatch, req(A, { params: { batchId: BATCH_A } }));
    expect(err).toBeUndefined();
    expect(res.statusCode).toBe(200);
    expectInternalOnly(A);
  });

  test("legacy corn-market export", async () => {
    const { res, err } = await invoke(
      cornMarket.getCornMarketProfiles,
      req(B, { query: { membershipStatus: "new", tenantId: A } }),
    );
    expect(err).toBeUndefined();
    expect(res.body.data.results.map((p) => p.membershipNo)).toEqual(["M-B"]);
    expectInternalOnly(B);
  });
});

describe("missing SUBSCRIPTION_SERVICE_URL fails closed (no fallback host, nothing written)", () => {
  beforeEach(() => {
    delete process.env.SUBSCRIPTION_SERVICE_URL;
  });

  test("createBatch -> 503, no request, no batch, no profile stamped", async () => {
    const { err } = await invoke(
      batch.createBatch,
      req(A, { body: { name: "b", type: "inmo-rewards", date: "2026-10-01" } }),
    );
    expect(err && err.status).toBe(503);
    expect(err.code).toBe("SUBSCRIPTION_SERVICE_URL_REQUIRED");
    expect(axios.get).not.toHaveBeenCalled();
    expect(Batch.all()).toHaveLength(0);
    expect(Profile.all().every((p) => p.batchId === null)).toBe(true);
  });

  test("refreshBatch -> 503 before any write (existing batch members untouched)", async () => {
    Batch.seed([{ _id: BATCH_A, tenantId: A, name: "A", type: "inmo-rewards", date: new Date("2026-10-01"), isDeleted: false, isActive: true, profileIds: [PA], profiles: [], createdBy: "x" }]);
    Profile.store.find((p) => p._id === PA).batchId = BATCH_A;
    const before = JSON.stringify(Batch.all());
    const { err } = await invoke(batch.refreshBatch, req(A, { params: { batchId: BATCH_A } }));
    expect(err && err.status).toBe(503);
    expect(axios.get).not.toHaveBeenCalled();
    expect(JSON.stringify(Batch.all())).toBe(before);
    expect(Profile.all().find((p) => p._id === PA).batchId).toBe(BATCH_A);
  });

  test("corn-market export -> 503, no request to any host", async () => {
    const { err } = await invoke(cornMarket.getCornMarketProfiles, req(A, { query: { membershipStatus: "new" } }));
    expect(err && err.status).toBe(503);
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("no hard-coded external host remains in the touched clients", () => {
    for (const f of ["controllers/batch.controller.js", "controllers/corn.market.controller.js", "services/subscriptionStartDate.client.js"]) {
      expect(fs.readFileSync(path.join(__dirname, "..", f), "utf8")).not.toMatch(/azurewebsites\.net|cloudapp\.azure\.com/);
    }
  });
});

describe("tenant is required", () => {
  test("lookup client refuses an empty tenant", async () => {
    const { fetchSubscriptionStartDates } = require("../services/subscriptionStartDate.client.js");
    await expect(fetchSubscriptionStartDates([PA], "")).rejects.toMatchObject({ status: 403 });
    expect(axios.get).not.toHaveBeenCalled();
  });
});

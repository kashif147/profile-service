"use strict";
/**
 * Duplicate merge is ASU-only (owner decision 2026-11-08), decided BEFORE any side effect, under both PDP rules:
 *   - "current": today's category rule - a non-ASU CRM caller is denied profile:* by the PDP (PDP_DENY);
 *   - "enforce": the P5 audience rule - the PDP PERMITs any CRM caller holding profile:write, so only the local
 *     requireTenantAdmin guard stands between MO and the merge.
 * REAL profile router + REAL controller (profile.duplicateReview.controller). Every mutating dependency is a spy:
 * the merge service, the consolidation service, the subscription-service and account-service merge clients, the
 * audit publisher and the Profile model's write methods. A refused caller must leave ALL of them uncalled.
 */
const os = require("os");
const path = require("path");
const fs = require("fs");
const http = require("http");

process.env.LOG_ROOT = process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-p5-merge-asu-"));
process.env.JWT_SECRET = "p5-merge-asu-only-test-secret";

let mockPdpModel = "enforce";
jest.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));
jest.mock("../middlewares/policy.middleware", () => {
  const requirePermission = (resource, action) => (req, res, next) => {
    const perms = (req.user && req.user.permissions) || [];
    if (perms.includes("*")) return next();
    // "current": the legacy category rule denies profile:* to every non-ASU CRM caller.
    if (mockPdpModel === "current" && resource === "profile") return res.status(403).json({ code: "PDP_DENY" });
    if (perms.includes(`${resource}:${action}`)) return next();
    return res.status(403).json({ code: "PDP_DENY" });
  };
  const m = { requirePermission };
  return { defaultPolicyMiddleware: m, ...m };
});
jest.mock("../models/profile.model.js", () => {
  const w = () => jest.fn(async () => ({ matchedCount: 0, modifiedCount: 0 }));
  return {
    findOne: jest.fn(() => ({ lean: async () => null, session: async () => null, select: () => ({ lean: async () => null }) })),
    find: jest.fn(() => ({ lean: async () => [] })),
    updateOne: w(), updateMany: w(), findOneAndUpdate: w(), findByIdAndUpdate: w(), create: w(), deleteOne: w(), deleteMany: w(),
  };
});
jest.mock("../models/user.model.js", () => require("./helpers/memoryModel").createMemoryModel("User"));
jest.mock("../services/duplicate.merge.service.js", () => ({
  executeProfileDuplicateMerge: jest.fn(async ({ masterProfileId, absorbedProfileId }) => ({ masterProfileId, absorbedProfileId })),
  validateMergeFieldChoices: jest.fn(),
  getProfileDuplicateMergeCompare: jest.fn(),
}));
jest.mock("../services/duplicate.detection.service.js", () => ({ detectProfileDuplicates: jest.fn(), findProfileDuplicateMatches: jest.fn() }));
jest.mock("../services/profile.merge.consolidation.service.js", () => ({
  consolidateProfileMergeHistory: jest.fn(), reassignProfileServiceReferences: jest.fn(),
}));
jest.mock("../services/subscription.service.client.js", () => ({
  reassignSubscriptionsForProfileMerge: jest.fn(), fetchCurrentSubscriptionByProfileId: jest.fn(),
}));
jest.mock("../services/account.service.client.js", () => ({
  reassignFinanceForProfileMerge: jest.fn(), fetchMemberFinanceSummary: jest.fn(),
}));
jest.mock("../services/profile.duplicate.audit.publisher.js", () => ({ publishProfileDuplicateMergedAudit: jest.fn() }));

function mockSentinelModule() {
  return new Proxy({}, {
    get: (_t, key) => (key === "__esModule" ? false : (req, res) => res.status(200).json({ reached: String(key) })),
  });
}
for (const m of [
  "../controllers/profile.controller.js", "../controllers/profile.validation.controller.js",
  "../controllers/aggregated.user.details.controller.js", "../controllers/profileApproval.controller.js",
  "../controllers/bulkApproval.controller.js", "../controllers/executiveCouncilApproval.controller.js",
  "../controllers/duplicateReview.controller.js", "../controllers/overlay.controller.js",
]) jest.doMock(m, () => mockSentinelModule());

const express = require("express");
const jwt = require("jsonwebtoken");
const Profile = require("../models/profile.model.js");
const mergeService = require("../services/duplicate.merge.service.js");
const consolidation = require("../services/profile.merge.consolidation.service.js");
const { reassignSubscriptionsForProfileMerge } = require("../services/subscription.service.client.js");
const { reassignFinanceForProfileMerge } = require("../services/account.service.client.js");
const { publishProfileDuplicateMergedAudit } = require("../services/profile.duplicate.audit.publisher.js");

const TA = "aaaaaaaaaaaaaaaaaaaaaaaa";
const PB = "a00000000000000000000002";
const PA = "a00000000000000000000001";
const ID = "c00000000000000000000009";
const tok = (userType, roles, permissions) =>
  ({ authorization: `Bearer ${jwt.sign({ sub: ID, id: ID, tenantId: TA, userType, roles, permissions }, process.env.JWT_SECRET)}` });

const MO = ["profile:read", "profile:write", "profile:delete", "profile:create", "application:write", "payments:read", "payments:write"];
const SUBS = ["subscriptions:read", "subscriptions:write", "subscriptions:create", "subscriptions:delete"];
const REFUSED = {
  MO: tok("CRM", ["MO"], MO),
  IRO_MO: tok("CRM", ["IRO", "MO"], [...MO, "issues-ir:read", "issues-ir:write"]),
  MO_WITH_SUBS: tok("CRM", ["MO"], ["profile:read", "profile:write", ...SUBS]),
  REO: tok("CRM", ["REO"], ["profile:read", "payments:read"]),
  SUBS_ONLY: tok("CRM", ["REO"], ["profile:read", ...SUBS]),
  FINANCE_WRITER: tok("CRM", ["AM"], ["profile:read", "profile:write", "payments:write"]),
  PORTAL: tok("PORTAL", ["MEMBER"], ["*", ...MO]),
  NO_TYPE: tok(undefined, ["MO"], ["*", ...MO]),
};
const ASU = tok("CRM", ["ASU", "REO"], ["*"]);

let server;
let baseUrl;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { res.success = (data) => res.status(200).json({ success: true, data }); next(); });
  app.use("/api/profile", require("../routes/profile.routes"));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.status || 500).json({ code: err.code, error: err.message }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => new Promise((r) => server.close(r)));
beforeEach(() => jest.clearAllMocks());

function merge(headers) {
  const raw = JSON.stringify({ targetProfileId: PA, mergeFieldChoices: {} });
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}/api/profile/${PB}/duplicate-merge`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(raw), ...headers },
    }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => { let j = null; try { j = JSON.parse(b); } catch (_e) { j = b; } resolve({ status: res.statusCode, body: j }); });
    });
    req.on("error", reject);
    req.write(raw);
    req.end();
  });
}

function sideEffects() {
  const writes = ["updateOne", "updateMany", "findOneAndUpdate", "findByIdAndUpdate", "create", "deleteOne", "deleteMany"]
    .reduce((n, k) => n + Profile[k].mock.calls.length, 0);
  return {
    executeProfileDuplicateMerge: mergeService.executeProfileDuplicateMerge.mock.calls.length,
    validateMergeFieldChoices: mergeService.validateMergeFieldChoices.mock.calls.length,
    reassignProfileServiceReferences: consolidation.reassignProfileServiceReferences.mock.calls.length,
    consolidateProfileMergeHistory: consolidation.consolidateProfileMergeHistory.mock.calls.length,
    subscriptionReassign: reassignSubscriptionsForProfileMerge.mock.calls.length,
    financeReassign: reassignFinanceForProfileMerge.mock.calls.length,
    audit: publishProfileDuplicateMergedAudit.mock.calls.length,
    profileWrites: writes,
  };
}
const NONE = {
  executeProfileDuplicateMerge: 0, validateMergeFieldChoices: 0, reassignProfileServiceReferences: 0,
  consolidateProfileMergeHistory: 0, subscriptionReassign: 0, financeReassign: 0, audit: 0, profileWrites: 0,
};

describe.each(["current", "enforce"])("PDP model: %s", (model) => {
  beforeAll(() => { mockPdpModel = model; });

  test.each(Object.keys(REFUSED))("%s is refused with ZERO side effects (no merge, no writes, no downstream call, no audit)", async (who) => {
    const r = await merge(REFUSED[who]);
    expect(r.status).toBe(403);
    expect(["TENANT_ADMIN_REQUIRED", "PDP_DENY", "CRM_ONLY"]).toContain(r.body && r.body.code);
    expect(sideEffects()).toEqual(NONE);
  });

  test("MO (profile:read + profile:write) under this model: refused before the controller runs", async () => {
    const r = await merge(REFUSED.MO);
    expect(r.body.code).toBe(model === "current" ? "PDP_DENY" : "TENANT_ADMIN_REQUIRED");
    expect(sideEffects()).toEqual(NONE);
  });

  test("ASU reaches the merge exactly once, for the requested pair in its own tenant", async () => {
    const r = await merge(ASU);
    expect(r.status).toBe(200);
    expect(mergeService.executeProfileDuplicateMerge).toHaveBeenCalledTimes(1);
    expect(mergeService.executeProfileDuplicateMerge.mock.calls[0][0]).toMatchObject({ masterProfileId: PB, absorbedProfileId: PA, tenantId: TA });
  });
});

test("the merge route is the ONLY profile-service path to the merge service (source guard)", () => {
  const root = path.join(__dirname, "..");
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!["node_modules", "tests", ".git"].includes(e.name)) walk(p); }
      else if (p.endsWith(".js") && /executeProfileDuplicateMerge\(|consolidateProfileMergeHistory\(|reassignProfileServiceReferences\(|reassignSubscriptionsForProfileMerge\(|reassignFinanceForProfileMerge\(/.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(root, p));
    }
  };
  walk(root);
  expect(hits.sort()).toEqual([
    "controllers/profile.duplicateReview.controller.js",
    "services/account.service.client.js",
    "services/duplicate.merge.service.js",
    "services/profile.merge.consolidation.service.js",
    "services/subscription.service.client.js",
  ]);
  const routes = fs.readFileSync(path.join(root, "routes/profile.routes.js"), "utf8");
  expect(routes).toMatch(/"\/:profileId\/duplicate-merge",\s*requireCrm\("profile", "write"\),\s*requireTenantAdmin,\s*submitProfileDuplicateMerge,/);
  expect((routes.match(/submitProfileDuplicateMerge/g) || []).length).toBe(2); // import + the one route
});

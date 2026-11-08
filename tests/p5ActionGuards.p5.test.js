"use strict";
/**
 * PDP rollout P5 prerequisite (blocker 1): local guards that keep profile soft delete, batch delete and CRM
 * payment-form writes unusable for MO / REO / IRO once audience enforcement lets their PDP checks pass, while the
 * duplicate merge stays available to the membership office (middlewares/p5ActionGuards.js).
 *
 * REAL routers (profile, batches, payment forms) with sentinel controllers. The PDP is modelled as it will behave
 * under P5 audience ENFORCE for a CRM caller: PERMIT iff the exact resource:action is in the token, or "*" (ASU own
 * tenant). That is the worst case for these routes - today's category rule denies MO/REO even earlier.
 * Caller claim sets mirror the live DEV roles (2026-11-08): MO (also held with IRO), REO, ASU, and AM (0 holders).
 */
const os = require("os");
const path = require("path");
const fs = require("fs");
const http = require("http");

process.env.LOG_ROOT = process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-p5-guards-"));
process.env.JWT_SECRET = "p5-action-guards-test-secret";

jest.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));
jest.mock("../models/profile.model.js", () => require("./helpers/memoryModel").createMemoryModel("Profile"));
jest.mock("../models/user.model.js", () => require("./helpers/memoryModel").createMemoryModel("User"));
jest.mock("../middlewares/policy.middleware", () => {
  const requirePermission = (resource, action) => (req, res, next) => {
    const perms = (req.user && req.user.permissions) || [];
    if (perms.includes("*") || perms.includes(`${resource}:${action}`)) return next();
    return res.status(403).json({ code: "PDP_DENY" });
  };
  const m = { requirePermission };
  return { defaultPolicyMiddleware: m, ...m };
});
jest.mock("../middlewares/idempotency.js", () => ({ idempotency: () => (req, res, next) => next() }));
jest.mock("../middlewares/validate.js", () => ({ validate: () => (req, res, next) => next() }));

function mockSentinelModule() {
  return new Proxy({}, {
    get: (_t, key) => (key === "__esModule" ? false : (req, res) => res.status(200).json({ reached: String(key) })),
  });
}
for (const m of [
  "../controllers/profile.controller.js", "../controllers/profile.validation.controller.js",
  "../controllers/profile.duplicateReview.controller.js", "../controllers/aggregated.user.details.controller.js",
  "../controllers/profileApproval.controller.js", "../controllers/bulkApproval.controller.js",
  "../controllers/executiveCouncilApproval.controller.js", "../controllers/duplicateReview.controller.js",
  "../controllers/overlay.controller.js", "../controllers/paymentForm.controller.js", "../controllers/batch.controller",
]) jest.doMock(m, () => mockSentinelModule());

const express = require("express");
const jwt = require("jsonwebtoken");
const guards = require("../middlewares/p5ActionGuards");

const TA = "aaaaaaaaaaaaaaaaaaaaaaaa";
const PB = "a00000000000000000000002";
const PA = "a00000000000000000000001";
const FORM = "f00000000000000000000002";
const BATCH = "d00000000000000000000001";
const ID = "c00000000000000000000009";

const tok = (userType, roles, permissions) =>
  ({ authorization: `Bearer ${jwt.sign({ sub: ID, tenantId: TA, userType, roles, permissions }, process.env.JWT_SECRET)}` });
const MO_PERMS = ["profile:read", "profile:write", "profile:delete", "profile:create", "application:write", "payments:read", "payments:write"];
const CALLERS = {
  ASU: tok("CRM", ["ASU", "REO"], ["*", "payments:read", "payments:write"]),
  MO: tok("CRM", ["MO"], MO_PERMS),
  IRO_MO: tok("CRM", ["IRO", "MO"], [...MO_PERMS, "issues-ir:read", "issues-ir:write"]),
  REO: tok("CRM", ["REO"], ["profile:read", "payments:read"]),
  AM: tok("CRM", ["AM"], ["payments:read", "payments:write"]),
  AM_DISPLAY: tok("CRM", [{ code: "Accounts Manager" }], ["payments:read", "payments:write"]),
  PORTAL_ALL: tok("PORTAL", ["MEMBER"], ["*", ...MO_PERMS]),
  NO_TYPE: tok(undefined, ["MO"], ["*", ...MO_PERMS]),
};

const PAYMENT_WRITES = [
  ["POST", "/api/payment-forms"],
  ["PATCH", `/api/payment-forms/${FORM}`],
  ["POST", `/api/payment-forms/${FORM}/submit`],
  ["POST", `/api/payment-forms/${FORM}/verify`],
  ["POST", `/api/payment-forms/${FORM}/approve`],
  ["POST", `/api/payment-forms/${FORM}/reject`],
  ["DELETE", `/api/payment-forms/${FORM}`],
  ["POST", `/api/payment-forms/${FORM}/upload-paper`],
  ["POST", `/api/payment-forms/${FORM}/upload-signed`],
  ["POST", `/api/payment-forms/${FORM}/upload-signature`],
  ["POST", `/api/payment-forms/${FORM}/send-email`],
];
const SOFT_DELETE = ["DELETE", `/api/profile/${PB}`];
const BATCH_DELETE = ["DELETE", `/api/batches/${BATCH}`];
const MERGE = ["POST", `/api/profile/${PB}/duplicate-merge`];

let server;
let baseUrl;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/profile", require("../routes/profile.routes"));
  app.use("/api/batches", require("../routes/batch.routes"));
  const { authenticate } = require("../middlewares/auth");
  app.use("/api/payment-forms", authenticate, require("../routes/paymentForm.routes"));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.status || 500).json({ code: err.code, error: err.message }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => new Promise((r) => server.close(r)));

function call([method, urlPath], headers, body) {
  const data = body === undefined ? (method === "GET" || method === "DELETE" ? undefined : {}) : body;
  const raw = data === undefined ? undefined : JSON.stringify(data);
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}${urlPath}`, {
      method,
      headers: { ...(raw ? { "content-type": "application/json", "content-length": Buffer.byteLength(raw) } : {}), ...headers },
    }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => { let j = null; try { j = b ? JSON.parse(b) : null; } catch (_e) { j = b; } resolve({ status: res.statusCode, body: j }); });
    });
    req.on("error", reject);
    if (raw) req.write(raw);
    req.end();
  });
}
const outcome = (r) => (r.status === 200 && r.body && r.body.reached ? "ALLOW" : `${r.status} ${r.body && r.body.code}`);

describe("profile soft delete and batch delete: tenant administrator only", () => {
  test.each([
    ["ASU", "ALLOW"],
    ["MO", "403 TENANT_ADMIN_REQUIRED"],
    ["IRO_MO", "403 TENANT_ADMIN_REQUIRED"],
    ["REO", "403 PDP_DENY"],
    ["AM", "403 PDP_DENY"],
    ["PORTAL_ALL", "403 CRM_ONLY"],
    ["NO_TYPE", "403 CRM_ONLY"],
  ])("%s -> %s (soft delete and batch delete)", async (who, expected) => {
    expect(outcome(await call(SOFT_DELETE, CALLERS[who]))).toBe(expected);
    expect(outcome(await call(BATCH_DELETE, CALLERS[who]))).toBe(expected);
  });
});

describe("duplicate merge: membership-office write workflow, separate from delete", () => {
  test.each([
    ["ASU", "ALLOW"],
    ["MO", "ALLOW"],
    ["IRO_MO", "ALLOW"],
    ["REO", "403 PDP_DENY"],
    ["AM", "403 PDP_DENY"],
    ["PORTAL_ALL", "403 CRM_ONLY"],
    ["NO_TYPE", "403 CRM_ONLY"],
  ])("%s -> %s", async (who, expected) => {
    expect(outcome(await call(MERGE, CALLERS[who], { targetProfileId: PA }))).toBe(expected);
  });

  test("profile:delete alone no longer authorises a merge; profile:write without profile:read is refused by the guard", async () => {
    expect(outcome(await call(MERGE, tok("CRM", ["X"], ["profile:delete"]), { targetProfileId: PA }))).toBe("403 PDP_DENY");
    expect(outcome(await call(MERGE, tok("CRM", ["X"], ["profile:write"]), { targetProfileId: PA }))).toBe("403 DUPLICATE_MERGE_NOT_PERMITTED");
  });

  test("the MO merge needs NO subscriptions:* claim (the subscription reassignment is a bound internal call)", async () => {
    expect(MO_PERMS.some((p) => p.startsWith("subscriptions:"))).toBe(false);
    expect(outcome(await call(MERGE, tok("CRM", ["MO"], ["profile:read", "profile:write"]), { targetProfileId: PA }))).toBe("ALLOW");
  });

  test("subscriptions:write (even with every subscriptions code) does not authorise a merge without profile:write", async () => {
    const subsOnly = ["subscriptions:read", "subscriptions:write", "subscriptions:create", "subscriptions:delete"];
    expect(outcome(await call(MERGE, tok("CRM", ["REO"], subsOnly), { targetProfileId: PA }))).toBe("403 PDP_DENY");
    expect(outcome(await call(MERGE, tok("CRM", ["REO"], ["profile:read", ...subsOnly]), { targetProfileId: PA }))).toBe("403 PDP_DENY");
  });
});

describe("CRM payment-form writes: finance action role (AM/DAM/ASU) or ASU wildcard", () => {
  test.each([
    ["ASU", "ALLOW"],
    ["AM", "ALLOW"],
    ["AM_DISPLAY", "ALLOW"],
    ["MO", "403 FINANCE_ACTION_ROLE_REQUIRED"],
    ["IRO_MO", "403 FINANCE_ACTION_ROLE_REQUIRED"],
    ["REO", "403 PDP_DENY"],
    ["PORTAL_ALL", "403 CRM_ONLY"],
    ["NO_TYPE", "403 CRM_ONLY"],
  ])("%s -> %s on every CRM write route", async (who, expected) => {
    for (const route of PAYMENT_WRITES) expect([route.join(" "), outcome(await call(route, CALLERS[who]))]).toEqual([route.join(" "), expected]);
  });

  test("a finance role without payments:write is still refused (PDP first, then the guard needs the literal claim)", async () => {
    expect(outcome(await call(PAYMENT_WRITES[0], tok("CRM", ["AM"], ["payments:read"])))).toBe("403 PDP_DENY");
  });

  test("CRM reads are unchanged: MO with payments:read still reaches the detail and list", async () => {
    expect(outcome(await call(["GET", `/api/payment-forms/${FORM}`], CALLERS.MO))).toBe("ALLOW");
    expect(outcome(await call(["GET", `/api/payment-forms/profile/${PB}`], CALLERS.MO))).toBe("ALLOW");
  });

  test("portal payment-form routes are untouched by the guard (no finance role needed)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../routes/paymentForm.routes.js"), "utf8");
    const portal = src.slice(src.indexOf("const portalRouter"), src.indexOf('router.use("/portal"'));
    expect(portal).not.toMatch(/crmWrite|requireFinanceActionRole/);
  });
});

describe("guard units (fail closed)", () => {
  const run = (mw, req) => { let e = "pending"; mw(req, {}, (x) => { e = x ? x.code : "NEXT"; }); return e; };
  test.each([
    [guards.requireTenantAdmin, { user: { userType: "PORTAL", permissions: ["*"] } }, "CRM_ONLY"],
    [guards.requireTenantAdmin, { user: { permissions: ["*"] } }, "CRM_ONLY"],
    [guards.requireTenantAdmin, { user: { userType: "crm", permissions: ["*"] } }, "NEXT"],
    [guards.requireTenantAdmin, { user: { userType: "CRM", permissions: ["profile:delete"] } }, "TENANT_ADMIN_REQUIRED"],
    [guards.requireDuplicateMergeAuthority, { user: { userType: "CRM", permissions: ["profile:read", "profile:write"] } }, "NEXT"],
    [guards.requireDuplicateMergeAuthority, { user: { userType: "CRM", permissions: ["profile:read"] } }, "DUPLICATE_MERGE_NOT_PERMITTED"],
    [guards.requireFinanceActionRole, { user: { userType: "CRM", roles: ["DAM"], permissions: ["payments:write"] } }, "NEXT"],
    [guards.requireFinanceActionRole, { user: { userType: "CRM", roles: ["MO"], permissions: ["payments:write"] } }, "FINANCE_ACTION_ROLE_REQUIRED"],
    [guards.requireFinanceActionRole, { user: { userType: "CRM", roles: ["AM"], permissions: ["payments:read"] } }, "FINANCE_ACTION_ROLE_REQUIRED"],
    [guards.requireFinanceActionRole, { user: { userType: "CRM", roles: [], permissions: [] }, roles: ["AM"], permissions: ["payments:write"] }, "NEXT"],
  ])("%#", (mw, req, expected) => expect(run(mw, req)).toBe(expected));
});

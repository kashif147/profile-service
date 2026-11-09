"use strict";
/**
 * P6 class C: transfer-request review (PUT /transfer-request/:requestId) needs requireCrm("transferRequests","write")
 * and then requireTransferReviewer ("*" / ASU, or MO + transferRequests:write). REO stays read-only even though
 * existing REO roles still carry the write code. Portal submit and own-list are unchanged.
 *
 * REAL router with a sentinel controller. PDP modelled as under P5 audience ENFORCE for CRM: PERMIT iff the exact
 * resource:action is in the token, or "*" (ASU own tenant) - the worst case for the local guard.
 */
const os = require("os");
const path = require("path");
const fs = require("fs");
const http = require("http");

process.env.LOG_ROOT = process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-p6-transfer-"));
process.env.JWT_SECRET = "p6-transfer-review-test-secret";

jest.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));
jest.mock("../middlewares/policy.middleware", () => {
  const requirePermission = (resource, action) => (req, res, next) => {
    mockPdpCalls.push(`${resource}:${action}`);
    const perms = ((req.user && req.user.permissions) || []).map((p) => String(p).toLowerCase());
    if (perms.includes("*") || perms.includes(`${resource}:${action}`.toLowerCase())) return next(); // as the PDP: case-insensitive
    return res.status(403).json({ code: "PDP_DENY" });
  };
  const m = { requirePermission };
  return { defaultPolicyMiddleware: m, ...m };
});
const mockPdpCalls = [];
jest.mock("../controllers/transfer.request.controller", () =>
  new Proxy({}, { get: (_t, key) => (key === "__esModule" ? false : (req, res) => res.status(200).json({ reached: String(key) })) }));

const express = require("express");
const jwt = require("jsonwebtoken");

const TA = "aaaaaaaaaaaaaaaaaaaaaaaa";
const ID = "c00000000000000000000009";
const REQ = "e00000000000000000000001";
const tok = (userType, roles, permissions) =>
  ({ authorization: `Bearer ${jwt.sign({ sub: ID, tenantId: TA, userType, roles, permissions }, process.env.JWT_SECRET)}` });

// Live DEV role shapes (2026-11-09) plus target-only shapes. Real tokens carry lower-cased claims
// (user-service generateToken), e.g. "transferrequests:write"; the camelCase form is also accepted.
const ALLOWED = {
  "ASU + REO (*)": tok("CRM", ["ASU", "REO"], ["*"]),
  "ASU + BO/IRO/REO/RO (*)": tok("CRM", ["ASU", "BO", "IRO", "REO", "RO"], ["*"]),
  "MO + IRO with transferrequests:write (real token form)": tok("CRM", ["IRO", "MO"], ["transferrequests:read", "transferrequests:write"]),
  "MO with camelCase transferRequests:write": tok("CRM", ["MO"], ["transferRequests:write"]),
  "MO as a role object { code }": tok("CRM", [{ id: "r1", code: "MO", name: "Membership Officer" }], ["transferrequests:write"]),
};
const REFUSED = {
  "REO with transferrequests:write": [tok("CRM", ["REO"], ["transferrequests:read", "transferrequests:write", "subscriptions:write"]), "TRANSFER_REVIEWER_REQUIRED"],
  "AM with transferrequests:write": [tok("CRM", ["AM"], ["transferrequests:write"]), "TRANSFER_REVIEWER_REQUIRED"],
  "MO without the claim": [tok("CRM", ["MO"], ["transferrequests:read"]), "PDP_DENY"],
  "PSG-CRM (no claims)": [tok("CRM", ["PSG-CRM"], []), "PDP_DENY"],
  "PORTAL MEMBER with transferRequests:write": [tok("PORTAL", ["MEMBER"], ["transferRequests:write", "*"]), "CRM_ONLY"],
  "no userType with *": [tok(undefined, ["ASU"], ["*"]), null],
};

let server;
let baseUrl;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/transfer-request", require("../routes/transfer.request.routes"));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.status || err.statusCode || 500).json({ code: err.code, error: err.message }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => new Promise((r) => server.close(r)));

function call(method, urlPath, headers, body) {
  const raw = body === undefined ? undefined : JSON.stringify(body);
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

const REVIEW = ["PUT", `/api/transfer-request/${REQ}`];

test.each(Object.entries(ALLOWED))("review allowed: %s", async (_label, headers) => {
  const before = mockPdpCalls.length;
  const r = await call(...REVIEW, headers, { action: "APPROVE" });
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ reached: "reviewTransferRequest" });
  expect(mockPdpCalls.slice(before)).toEqual(["transferRequests:write"]);
});

test.each(Object.entries(REFUSED))("review refused before the controller: %s", async (_label, [headers, code]) => {
  const r = await call(...REVIEW, headers, { action: "APPROVE" });
  expect([401, 403]).toContain(r.status);
  expect(r.body && r.body.reached).toBeUndefined();
  if (code) expect(r.body.code).toBe(code);
});

test("portal self-service submit and own-list are unchanged (no PDP, no reviewer guard)", async () => {
  const portal = tok("PORTAL", ["MEMBER"], []);
  const before = mockPdpCalls.length;
  expect((await call("POST", "/api/transfer-request", portal, { workLocation: "x" })).body).toEqual({ reached: "submitTransferRequest" });
  expect((await call("GET", "/api/transfer-request/portal", portal)).body).toEqual({ reached: "getTransferRequestsForPortal" });
  expect(mockPdpCalls.length).toBe(before);
});

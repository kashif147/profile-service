"use strict";
/**
 * P5 profile batch / legacy corn-market route gates (REAL routers, sentinel controllers).
 *
 *   GET  /batches, GET /batches/:id, GET /corn-market   -> CRM + profile:read
 *   POST /batches, PUT /batches/:id, POST /:id/refresh  -> CRM + profile:write
 *   DELETE /batches/:id                                  -> CRM + profile:delete + tenant administrator ("*", P5
 *                                                           prerequisite, middlewares/p5ActionGuards.js)
 *
 * Two PDP models:
 *   "exact"    permit iff the exact resource:action is in the verified token - proves each route asks
 *              for the right action and that read never authorizes create/mutation/delete.
 *   "category" models the live user-service PDP category rule for the `profile` resource (category
 *              PROFILE): a non-ASU CRM caller is refused even WITH profile:read; ASU passes through its
 *              own-tenant admin rule. This documents the known consequence - these routes are ASU-only
 *              until the PDP consumer migration - and proves nothing in profile-service compensates for
 *              it with a weaker check or bypass.
 */
const os = require("os");
const path = require("path");
const fs = require("fs");
const http = require("http");

process.env.LOG_ROOT = process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-p5-batch-"));
process.env.JWT_SECRET = "p5-batch-gates-test-secret";

jest.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));

let mockPdpModel = "exact";
jest.mock("../middlewares/policy.middleware", () => {
  const requirePermission = (resource, action) => (req, res, next) => {
    const perms = (req.user && req.user.permissions) || [];
    const roles = ((req.user && req.user.roles) || []).map((r) => String(r.code || r).toUpperCase());
    if (mockPdpModel === "category") {
      if (roles.includes("ASU")) return next(); // ASU_OWN_TENANT_ADMIN (tenant pinned by the auth layer)
      if (resource === "profile") return res.status(403).json({ code: "PDP_DENY", reason: "INVALID_USER_TYPE" });
    }
    if (perms.includes(`${resource}:${action}`)) return next();
    return res.status(403).json({ code: "PDP_DENY", reason: "INSUFFICIENT_RESOURCE_PERMISSION" });
  };
  const m = { requirePermission };
  return { defaultPolicyMiddleware: m, ...m };
});

function mockSentinelModule() {
  return new Proxy(
    {},
    {
      get: (_t, key) =>
        key === "__esModule"
          ? false
          : (req, res) => res.status(200).json({ reached: String(key), tenantId: req.tenantId || null }),
    },
  );
}
jest.mock("../controllers/batch.controller", () => mockSentinelModule());
jest.mock("../controllers/corn.market.controller", () => mockSentinelModule());

const express = require("express");
const jwt = require("jsonwebtoken");

const TA = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TB = "bbbbbbbbbbbbbbbbbbbbbbbb";
const CRM_ID = "c00000000000000000000009";
const BATCH = "d00000000000000000000001";

const token = (claims) => `Bearer ${jwt.sign(claims, process.env.JWT_SECRET)}`;
const crm = (permissions, extra = {}) => ({
  authorization: token({ sub: CRM_ID, tenantId: TA, userType: "CRM", permissions, ...extra }),
});
const asRead = crm(["profile:read"]);
const asWrite = crm(["profile:write"]);
const asDelete = crm(["profile:delete"]);
const asAll = crm(["profile:read", "profile:write", "profile:delete"]);
const asNone = crm([]);
const asPortalAll = {
  authorization: token({
    sub: "a20000000000000000000001",
    tenantId: TA,
    userType: "PORTAL",
    permissions: ["profile:read", "profile:write", "profile:delete", "profile:create"],
  }),
};
// A real ASU token carries the computed own-tenant wildcard "*" (user-service role.handler) and the ASU role.
const asAsu = crm(["*"], { roles: [{ code: "ASU" }] });
const asDeleteAdmin = crm(["*", "profile:delete"], { roles: [{ code: "ASU" }] });

let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/batches", require("../routes/batch.routes"));
  app.use("/api/corn-market", require("../routes/corn.market.routes"));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.status || 500).json({ code: err.code, error: err.message }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  mockPdpModel = "exact";
});

function call(method, urlPath, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      `${baseUrl}${urlPath}`,
      {
        method,
        headers: {
          ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
          ...headers,
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

const reached = (r) => r.status === 200 && r.body && typeof r.body.reached === "string";

// [method, url, required action, controller handler, body]
const ROUTES = [
  ["GET", "/api/batches", "read", "getAllBatches", undefined],
  ["GET", `/api/batches/${BATCH}`, "read", "getBatchById", undefined],
  ["GET", "/api/corn-market?membershipStatus=new", "read", "getCornMarketProfiles", undefined],
  ["POST", "/api/batches", "write", "createBatch", { name: "x" }],
  ["PUT", `/api/batches/${BATCH}`, "write", "updateBatch", { name: "y" }],
  ["POST", `/api/batches/${BATCH}/refresh`, "write", "refreshBatch", {}],
  ["DELETE", `/api/batches/${BATCH}`, "delete", "deleteBatch", undefined],
];
const AS = { read: asRead, write: asWrite, delete: asDeleteAdmin };

describe("exact permission per action", () => {
  test.each(ROUTES)("%s %s -> CRM + profile:%s reaches the handler", async (method, url, action, handler, body) => {
    const r = await call(method, url, AS[action], body);
    expect(reached(r)).toBe(true);
    expect(r.body.reached).toBe(handler);
  });

  test.each(ROUTES)("%s %s -> CRM without any profile permission is 403", async (method, url, _action, _handler, body) => {
    const r = await call(method, url, asNone, body);
    expect(r.status).toBe(403);
    expect(reached(r)).toBe(false);
  });

  test.each(ROUTES.filter((r) => r[2] !== "read"))(
    "%s %s -> profile:read never authorizes a mutation",
    async (method, url, _action, _handler, body) => {
      const r = await call(method, url, asRead, body);
      expect(r.status).toBe(403);
      expect(reached(r)).toBe(false);
    },
  );

  test.each(ROUTES.filter((r) => r[2] === "write"))(
    "%s %s -> profile:delete alone does not authorize create/update/refresh",
    async (method, url, _action, _handler, body) => {
      expect((await call(method, url, asDelete, body)).status).toBe(403);
    },
  );

  test("DELETE: profile:delete without the tenant-administrator wildcard is 403 TENANT_ADMIN_REQUIRED", async () => {
    const r = await call("DELETE", `/api/batches/${BATCH}`, asDelete);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("TENANT_ADMIN_REQUIRED");
    expect(reached(r)).toBe(false);
  });

  test("DELETE needs profile:delete: profile:write alone is 403", async () => {
    expect((await call("DELETE", `/api/batches/${BATCH}`, asWrite)).status).toBe(403);
  });

  test.each(ROUTES)("%s %s -> PORTAL caller with every profile code is CRM_ONLY", async (method, url, _action, _handler, body) => {
    const r = await call(method, url, asPortalAll, body);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("CRM_ONLY");
  });

  test.each(ROUTES)("%s %s -> unauthenticated is refused", async (method, url, _action, _handler, body) => {
    const r = await call(method, url, {}, body);
    expect(r.status).toBeGreaterThanOrEqual(400); // existing auth layer: 400 for a missing token
    expect(reached(r)).toBe(false);
  });

  test("tenant comes from the verified token, not the body or query", async () => {
    const r = await call("POST", `/api/batches?tenantId=${TB}`, asAll, { name: "x", tenantId: TB });
    expect(reached(r)).toBe(true);
    expect(r.body.tenantId).toBe(TA);
  });
});

describe("known PDP category denial (documented, not role support)", () => {
  beforeEach(() => {
    mockPdpModel = "category";
  });

  test.each(ROUTES)("%s %s -> non-ASU CRM holding the exact code is still refused", async (method, url, _action, _handler, body) => {
    const r = await call(method, url, asAll, body);
    expect(r.status).toBe(403);
    expect(r.body.reason).toBe("INVALID_USER_TYPE");
    expect(reached(r)).toBe(false);
  });

  test.each(ROUTES)("%s %s -> ASU (own-tenant admin rule) reaches the handler", async (method, url, _action, _handler, body) => {
    expect(reached(await call(method, url, asAsu, body))).toBe(true);
  });
});

"use strict";
/**
 * Phase 1A adoption — profile-service tenant-context guard (WARN MODE).
 *
 * (A) behaviour of the warn-mode middleware profile-service now consumes from
 *     @membership/policy-middleware@1d4a3b9 (identical to the exported
 *     `tenantContextWarn` in middlewares/auth.js), and
 * (B) that the adoption is wired correctly — auth.js builds/exports it in WARN
 *     mode, app.js mounts it after the global `authenticate` and before
 *     routes/index, profile.routes pairs it after its internal `authenticate`,
 *     and the pre-auth /validate, /internal/*, /batch and /api/system-logs
 *     surfaces are excluded.
 *
 * Behaviour tests build their own `tenantContextMiddleware({ mode: "warn" })`
 * rather than requiring middlewares/auth.js (which pulls in app config); it is
 * exactly what the routes mount. Wiring is verified by static source reads.
 *
 * Run: npx jest tests/tenantContext.adoption.test.js
 */
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.LOG_ROOT =
  process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-tenantctx-"));
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const policyMw = require("@membership/policy-middleware");
const { tenantContextMiddleware } = policyMw;

const TRUSTED = "68cbf7806080b4621d469d34"; // INMO Tenant._id
const OTHER = "aaaaaaaaaaaaaaaaaaaaaaaa";

const tenantContextWarn = tenantContextMiddleware({ mode: "warn" });

function gatewayReq(overrides = {}) {
  return {
    method: "GET",
    url: "/api/profile",
    originalUrl: "/api/profile",
    headers: {
      "x-jwt-verified": "true",
      "x-auth-source": "gateway",
      "x-user-id": "U1",
      "x-tenant-id": TRUSTED,
      ...(overrides.headers || {}),
    },
    ctx: overrides.ctx !== undefined ? overrides.ctx : { tenantId: TRUSTED, userId: "U1" },
    tenantId: overrides.tenantId,
    body: overrides.body,
    query: overrides.query,
    params: overrides.params,
  };
}
function mkRes() {
  const r = { statusCode: null, _statusCalls: [] };
  r.status = (c) => (r.statusCode = c, r._statusCalls.push(c), r);
  r.json = () => r;
  return r;
}
function run(req) {
  const res = mkRes();
  const orig = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (s) => (chunks.push(typeof s === "string" ? s : s.toString()), true);
  let nextCount = 0;
  try {
    tenantContextWarn(req, res, () => (nextCount += 1));
  } finally {
    process.stdout.write = orig;
  }
  const rows = chunks
    .join("")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch (_e) {
        return null;
      }
    })
    .filter(Boolean);
  return { req, res, nextCount, rows };
}
const readSrc = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

describe("profile-service tenantContextWarn — behaviour (warn mode)", () => {
  test("1 trusted tenant stays authoritative (pins req.tenantId), next() called", () => {
    const { req, nextCount, res } = run(gatewayReq());
    expect(req.tenantId).toBe(TRUSTED);
    expect(nextCount).toBe(1);
    expect(res.statusCode).toBeNull();
  });
  test("2 query tenant mismatch does NOT override trusted tenant", () => {
    const { req, nextCount } = run(gatewayReq({ query: { tenantId: OTHER } }));
    expect(req.tenantId).toBe(TRUSTED);
    expect(nextCount).toBe(1);
  });
  test("3 body tenant mismatch does NOT override trusted tenant", () => {
    const { req, nextCount } = run(gatewayReq({ body: { tenantId: OTHER } }));
    expect(req.tenantId).toBe(TRUSTED);
    expect(nextCount).toBe(1);
  });
  test("4 warn mode never returns 403 on mismatch", () => {
    const { res, nextCount } = run(gatewayReq({ body: { tenantId: OTHER } }));
    expect(res._statusCalls).not.toContain(403);
    expect(res.statusCode).toBeNull();
    expect(nextCount).toBe(1);
  });
  test("5 TenantContextMismatch emitted for a mismatch", () => {
    const { rows } = run(gatewayReq({ query: { tenantId: OTHER } }));
    expect(rows.find((r) => r.eventType === "TenantContextMismatch")).toBeTruthy();
  });
  test("6 mismatch log carries mode=warn, outcome=ignored, trustedTenantId, suppliedSources", () => {
    const { rows } = run(gatewayReq({ query: { tenantId: OTHER } }));
    const row = rows.find((r) => r.eventType === "TenantContextMismatch");
    expect(row.mode).toBe("warn");
    expect(row.outcome).toBe("ignored");
    expect(row.trustedTenantId).toBe(TRUSTED);
    expect(row.suppliedSources).toContain("query");
    expect(row.service).toBe("policy-middleware");
  });
  test("7 no mismatch log when supplied tenant equals trusted", () => {
    const { rows, nextCount } = run(gatewayReq({ body: { tenantId: TRUSTED } }));
    expect(rows.find((r) => r.eventType === "TenantContextMismatch")).toBeUndefined();
    expect(nextCount).toBe(1);
  });
});

describe("profile-service tenantContextWarn — adoption wiring", () => {
  test("8 installed package exposes tenantContextMiddleware", () => {
    expect(typeof policyMw.tenantContextMiddleware).toBe("function");
  });
  test("9 installed package exposes resolveTenantContext", () => {
    expect(typeof policyMw.resolveTenantContext).toBe("function");
  });
  test("10 app.js mounts tenantContextWarn after authenticate and before routes/index", () => {
    const src = readSrc("app.js");
    const iAuth = src.indexOf("app.use(authenticate)");
    const iWarn = src.indexOf("app.use(tenantContextWarn)");
    const iRoutes = src.indexOf('require("./routes/index")');
    expect(iAuth).toBeGreaterThan(-1);
    expect(iWarn).toBeGreaterThan(iAuth);
    expect(iRoutes).toBeGreaterThan(iWarn);
  });
  test("11 profile.routes authenticated group pairs authenticate + tenantContextWarn", () => {
    const src = readSrc(path.join("routes", "profile.routes.js"));
    expect(src).toMatch(/router\.use\(\s*authenticate\s*,\s*tenantContextWarn\s*\)/);
    expect(src).toContain('require("../middlewares/auth")');
  });
  test("12 pre-auth /validate, /internal/*, /batch are BEFORE the guard; system-logs excluded", () => {
    const src = readSrc(path.join("routes", "profile.routes.js"));
    const guard = src.indexOf("router.use(authenticate, tenantContextWarn)");
    for (const pre of ['router.post("/validate"', 'router.get("/internal/by-email"', 'router.post("/batch"', 'router.get("/batch"']) {
      const i = src.indexOf(pre);
      expect(i).toBeGreaterThan(-1);
      expect(i).toBeLessThan(guard); // excluded: mounted before the guard
    }
    // app.js: system-logs ingest router is mounted before the global authenticate,
    // so tenantContextWarn (mounted after authenticate) never covers it.
    const app = readSrc("app.js");
    const iSysLogs = app.indexOf("createSystemLogsRouter");
    const iAuth = app.indexOf("app.use(authenticate)");
    expect(iSysLogs).toBeGreaterThan(-1);
    expect(iSysLogs).toBeLessThan(iAuth);
  });
});

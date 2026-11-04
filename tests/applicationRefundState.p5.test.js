"use strict";
/**
 * P5 application refund state: signed account-service -> profile-service lookup.
 *   GET /api/internal/applications/:applicationId/refund-state   (p5-svc-sig/1, audience profile-service)
 *
 * REAL app.js (mount order, global middleware) + REAL throwaway mongod (real PersonalDetails model,
 * real unique (caller, nonce) index). In-test random signing key and JWT secret. Skipped only when
 * no mongod is on PATH (the vector tests always run).
 *
 * contracts/p5-service-signing.application-refund-state.v1.json is byte-identical in
 * account-service (signer); its SHA-256 is pinned here and there.
 */
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn, spawnSync } = require("child_process");

process.env.LOG_ROOT = process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-refund-state-"));
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = `refund-state-test-${crypto.randomBytes(24).toString("hex")}`;
delete process.env.RABBIT_URL;

jest.mock("uuid", () => ({ v4: () => require("crypto").randomUUID() }));

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const S = require("../services/serviceSignatureVerify");
const { evaluate, createServiceSignatureAuth, STATUS } = require("../middlewares/serviceSignatureAuth");

const VECTORS_SHA256 = "41c8a9c1b68c06ce2b623d97397035a84696185fe8c60926e8f3ed20bd073652";
const RAW = fs.readFileSync(path.join(__dirname, "..", "contracts", "p5-service-signing.application-refund-state.v1.json"));
const V = JSON.parse(RAW.toString("utf8"));

const TA = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TB = "bbbbbbbbbbbbbbbbbbbbbbbb";
const KID = "as-test-1";
const SECRET = crypto.randomBytes(32).toString("hex");
const ENV_KEYS = ["APPLICATION_STATE_SERVICE_AUTH_MODE", "SVC_SIGNING_KEYS_ACCOUNT_SERVICE", "SVC_SIGNING_KEYS_EVENTS_SERVICE", "AUTH_BYPASS_ENABLED"];
const saved = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Memory nonce store with real unique semantics, for the non-HTTP tests. */
function memoryNonceModel() {
  const seen = new Set();
  return {
    seen,
    async create({ caller, nonce }) {
      const k = `${caller}\0${nonce}`;
      if (seen.has(k)) throw Object.assign(new Error("dup"), { code: 11000 });
      seen.add(k);
    },
  };
}

// ------------------------------------------------------------------ shared vectors (always run)
describe("p5-svc-sig/1 shared vectors (application_refund_state)", () => {
  test("vector file is the pinned, byte-identical contract", () => {
    expect(crypto.createHash("sha256").update(RAW).digest("hex")).toBe(VECTORS_SHA256);
    expect(V).toMatchObject({ contract: "p5-svc-sig", version: 1, audience: "profile-service", caller: "account-service", operation: "application_refund_state", maxSkewSeconds: 60 });
    expect(S.AUDIENCE).toBe("profile-service");
  });

  test("local canonicalization reproduces every vector (incl. the p5-service-signing.v1 compatibility vector)", () => {
    expect(V.vectors.length).toBeGreaterThanOrEqual(4);
    for (const v of V.vectors) {
      const i = v.input;
      const bodySha256 = S.sha256Hex(Buffer.from(i.body, "utf8"));
      expect(bodySha256).toBe(v.expect.bodySha256);
      const canonical = S.canonicalString({ ...i, bodySha256 });
      expect(canonical).toBe(v.expect.canonical);
      expect(S.signCanonical(v.secret, canonical)).toBe(v.expect.sig);
    }
  });

  test("verifier accepts the account-signed vector requests and rejects the other-audience vector", async () => {
    for (const v of V.vectors) {
      const i = v.input;
      const req = {
        method: i.method,
        originalUrl: i.target,
        headers: {
          "x-svc-version": "1", "x-svc-caller": i.caller, "x-svc-kid": i.kid, "x-svc-ts": i.ts,
          "x-svc-nonce": i.nonce, "x-svc-sig": v.expect.sig, "x-tenant-id": i.tenant,
        },
      };
      const env = { SVC_SIGNING_KEYS_ACCOUNT_SERVICE: `${i.kid}:${v.secret}`, SVC_SIGNING_KEYS_EVENTS_SERVICE: `${i.kid}:${v.secret}` };
      const r = await evaluate(req, "application_refund_state", { env, nowSeconds: () => Number(i.ts), NonceModel: memoryNonceModel(), storeReady: async () => true });
      if (i.aud === "profile-service") expect(r).toMatchObject({ outcome: "valid", caller: "account-service", tenantId: i.tenant });
      else expect(r.outcome).not.toBe("valid"); // audience account-service / caller events-service never verifies here
    }
  });

  test("tenant is covered by the signature: the tenant-changed vector differs", () => {
    const [, a, , c] = V.vectors;
    expect(a.input.target).toBe(c.input.target);
    expect(a.input.tenant).not.toBe(c.input.tenant);
    expect(a.expect.sig).not.toBe(c.expect.sig);
  });

  test("verifier logs carry no signature, nonce or secret", async () => {
    const lines = [];
    const logger = { info: (f) => lines.push(f), warn: (f) => lines.push(f) };
    const v = V.vectors[1];
    const mw = createServiceSignatureAuth("application_refund_state", {
      env: { APPLICATION_STATE_SERVICE_AUTH_MODE: "report", SVC_SIGNING_KEYS_ACCOUNT_SERVICE: `${v.input.kid}:${v.secret}` },
      nowSeconds: () => Number(v.input.ts), NonceModel: memoryNonceModel(), storeReady: async () => true, logger,
    });
    const res = { set() {}, status() { return this; }, json() { return this; } };
    const req = { method: "GET", originalUrl: v.input.target, headers: { "x-svc-version": "1", "x-svc-caller": "account-service", "x-svc-kid": v.input.kid, "x-svc-ts": v.input.ts, "x-svc-nonce": v.input.nonce, "x-svc-sig": v.expect.sig, "x-tenant-id": v.input.tenant } };
    await new Promise((resolve) => mw(req, res, resolve));
    await mw({ ...req, headers: { ...req.headers } }, res, () => {}); // replay
    expect(lines.map((l) => l.outcome)).toEqual(["valid", "SERVICE_AUTH_REPLAY"]);
    const text = JSON.stringify(lines);
    for (const secretish of [v.expect.sig, v.input.nonce, v.secret]) expect(text).not.toContain(secretish);
  });
});

// ------------------------------------------------------------------ real app + real mongod
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

const haveMongo = spawnSync("mongod", ["--version"]).status === 0;
const d = haveMongo ? describe : describe.skip;

d("GET /api/internal/applications/:applicationId/refund-state (real app, real mongod)", () => {
  let mongodProc = null;
  let mongodDir = null;
  let uri;
  let server;
  let base;
  let PersonalDetails;
  let Nonce;

  async function connect() {
    for (let i = 0; i < 100; i++) {
      try {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 500 });
        return;
      } catch (_e) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error("mongod did not start");
  }

  beforeAll(async () => {
    mongodDir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-refund-state-mongod-"));
    const port = await freePort();
    mongodProc = spawn("mongod", ["--dbpath", mongodDir, "--port", String(port), "--bind_ip", "127.0.0.1", "--quiet"], { stdio: "ignore" });
    uri = `mongodb://127.0.0.1:${port}/profile_refund_state_test`;
    await connect();
    PersonalDetails = require("../models/personal.details.model.js");
    Nonce = require("../models/serviceAuthNonce.model.js");
    await Nonce.init();
    const app = require("../app");
    server = await new Promise((r) => {
      const s = app.listen(0, "127.0.0.1", () => r(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
  }, 60000);

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    try {
      await mongoose.connection.db.dropDatabase();
    } catch (_e) {
      /* ignore */
    }
    await mongoose.disconnect();
    if (mongodProc) mongodProc.kill("SIGKILL");
    if (mongodDir) fs.rmSync(mongodDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    process.env.APPLICATION_STATE_SERVICE_AUTH_MODE = "enforce";
    process.env.SVC_SIGNING_KEYS_ACCOUNT_SERVICE = `${KID}:${SECRET}`;
    delete process.env.SVC_SIGNING_KEYS_EVENTS_SERVICE;
    process.env.AUTH_BYPASS_ENABLED = "true"; // tests/setup.js default: must give this route nothing
  });

  async function seed(tenantId, status, extra = {}) {
    const applicationId = crypto.randomUUID();
    await PersonalDetails.collection.insertOne({ tenantId, applicationId, ...(status ? { applicationStatus: status } : {}), ...extra });
    return applicationId;
  }

  const target = (id) => `/api/internal/applications/${id}/refund-state`;

  function signed(pathAndQuery, { tenant = TA, caller = "account-service", kid = KID, secret = SECRET, ts, nonce, method = "GET" } = {}) {
    const tsV = String(ts ?? Math.floor(Date.now() / 1000));
    const nonceV = nonce || crypto.randomBytes(18).toString("base64url");
    const canonical = S.canonicalString({ caller, kid, method, target: pathAndQuery, tenant, idem: "", bodySha256: S.sha256Hex(Buffer.alloc(0)), ts: tsV, nonce: nonceV });
    return {
      "x-svc-version": "1", "x-svc-caller": caller, "x-svc-kid": kid, "x-svc-ts": tsV,
      "x-svc-nonce": nonceV, "x-svc-sig": S.signCanonical(secret, canonical), "x-tenant-id": tenant,
    };
  }

  async function call(pathAndQuery, headers = {}, { method = "GET", body } = {}) {
    const res = await fetch(`${base}${pathAndQuery}`, { method, headers: body ? { ...headers, "content-type": "application/json" } : headers, body });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_e) {
      json = null;
    }
    return { status: res.status, json, text };
  }

  test("valid signature -> 200 with exactly applicationId, tenantId, status (each status)", async () => {
    for (const status of ["in-progress", "submitted", "processed", "rejected"]) {
      const id = await seed(TA, status, { personalInfo: { surname: "Secret" }, contactInfo: { personalEmail: "x@example.com" } });
      const r = await call(target(id), signed(target(id)));
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ data: { applicationId: id, tenantId: TA, status } });
      expect(Object.keys(r.json)).toEqual(["data"]);
      expect(Object.keys(r.json.data).sort()).toEqual(["applicationId", "status", "tenantId"]);
    }
  });

  test("legacy ApplicationId root and ObjectId-shaped ids resolve the same way", async () => {
    const legacy = "c".repeat(24);
    await PersonalDetails.collection.insertOne({ tenantId: TA, ApplicationId: legacy, applicationStatus: "submitted" });
    const r = await call(target(legacy), signed(target(legacy)));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ data: { applicationId: legacy, tenantId: TA, status: "submitted" } });
  });

  test("missing signature -> 401 SERVICE_AUTH_REQUIRED", async () => {
    const id = await seed(TA, "submitted");
    const r = await call(target(id), { "x-tenant-id": TA, "x-internal-request": "true" });
    expect(r.status).toBe(401);
    expect(r.json.code).toBe("SERVICE_AUTH_REQUIRED");
    expect(r.text).not.toContain("submitted");
  });

  test("malformed headers / version / tenant -> 401 SERVICE_AUTH_MALFORMED", async () => {
    const id = await seed(TA, "submitted");
    const h = signed(target(id));
    for (const bad of [{ "x-svc-version": "2" }, { "x-svc-sig": "short" }, { "x-svc-nonce": "x" }, { "x-svc-ts": "-1" }, { "x-tenant-id": "not-a-tenant" }]) {
      const r = await call(target(id), { ...h, ...bad });
      expect(r.status).toBe(401);
      expect(r.json.code).toBe("SERVICE_AUTH_MALFORMED");
    }
  });

  test("invalid signature (wrong key, tampered tenant/path/query/method) -> 401 SERVICE_AUTH_INVALID", async () => {
    const id = await seed(TA, "submitted");
    const other = await seed(TA, "rejected");
    const cases = [
      [target(id), signed(target(id), { secret: crypto.randomBytes(32).toString("hex") })],
      [target(id), { ...signed(target(id), { tenant: TB }), "x-tenant-id": TA }],
      [target(other), signed(target(id))],
      [`${target(id)}?x=1`, signed(target(id))],
      [target(id), signed(target(id), { method: "POST" })],
    ];
    for (const [p, h] of cases) {
      const r = await call(p, h);
      expect(r.status).toBe(401);
      expect(r.json.code).toBe("SERVICE_AUTH_INVALID");
    }
  });

  test("expired / future timestamp beyond 60 s -> 401 SERVICE_AUTH_STALE; within 60 s accepted", async () => {
    const id = await seed(TA, "submitted");
    const now = Math.floor(Date.now() / 1000);
    for (const ts of [now - 61, now + 61, now - 3600]) {
      const r = await call(target(id), signed(target(id), { ts }));
      expect(r.status).toBe(401);
      expect(r.json.code).toBe("SERVICE_AUTH_STALE");
    }
    expect((await call(target(id), signed(target(id), { ts: now - 50 }))).status).toBe(200);
  });

  test("replayed nonce -> first 200, every later use 401 SERVICE_AUTH_REPLAY (also concurrently)", async () => {
    const id = await seed(TA, "submitted");
    const h = signed(target(id));
    expect((await call(target(id), h)).status).toBe(200);
    const again = await call(target(id), h);
    expect(again.status).toBe(401);
    expect(again.json.code).toBe("SERVICE_AUTH_REPLAY");
    const h2 = signed(target(id));
    const many = await Promise.all(Array.from({ length: 8 }, () => call(target(id), h2)));
    expect(many.filter((r) => r.status === 200)).toHaveLength(1);
    expect(many.filter((r) => r.status === 401 && r.json.code === "SERVICE_AUTH_REPLAY")).toHaveLength(7);
  });

  test("unknown kid -> 401 SERVICE_AUTH_UNKNOWN_KID", async () => {
    const id = await seed(TA, "submitted");
    const r = await call(target(id), signed(target(id), { kid: "as-unknown" }));
    expect(r.status).toBe(401);
    expect(r.json.code).toBe("SERVICE_AUTH_UNKNOWN_KID");
  });

  test("wrong caller -> 403 SERVICE_NOT_ALLOWED, even with a configured key for that caller", async () => {
    const id = await seed(TA, "submitted");
    process.env.SVC_SIGNING_KEYS_EVENTS_SERVICE = `${KID}:${SECRET}`;
    for (const caller of ["events-service", "profile-service", "portal-service"]) {
      const r = await call(target(id), signed(target(id), { caller }));
      expect(r.status).toBe(403);
      expect(r.json.code).toBe("SERVICE_NOT_ALLOWED");
      expect(r.text).not.toContain("submitted");
    }
  });

  test("tenant mismatch: application in tenant B, signed tenant A -> 404, no leak", async () => {
    const idB = await seed(TB, "processed");
    const r = await call(target(idB), signed(target(idB), { tenant: TA }));
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ success: false, code: "APPLICATION_NOT_FOUND", message: "Application not found" });
    expect(r.text).not.toContain(TB);
    expect(r.text).not.toContain("processed");
    // the same application in its own tenant is found
    expect((await call(target(idB), signed(target(idB), { tenant: TB }))).json.data.tenantId).toBe(TB);
  });

  test("not found / malformed id -> 404 APPLICATION_NOT_FOUND", async () => {
    for (const id of [crypto.randomUUID(), "x".repeat(65), "a%24ne"]) {
      const r = await call(target(id), signed(target(id)));
      expect(r.status).toBe(404);
      expect(r.json.code).toBe("APPLICATION_NOT_FOUND");
    }
  });

  test("unrecognised stored status -> 422 APPLICATION_STATE_UNRECOGNISED (never guessed)", async () => {
    const id = await seed(TA, null);
    const r = await call(target(id), signed(target(id)));
    expect(r.status).toBe(422);
    expect(r.json.code).toBe("APPLICATION_STATE_UNRECOGNISED");
  });

  test("nonce store down -> 503 SERVICE_AUTH_STORE_UNAVAILABLE (distinct from auth and not found)", async () => {
    const id = await seed(TA, "submitted");
    await mongoose.disconnect();
    try {
      const r = await call(target(id), signed(target(id)));
      expect(r.status).toBe(503);
      expect(r.json.code).toBe("SERVICE_AUTH_STORE_UNAVAILABLE");
    } finally {
      await connect();
    }
    expect((await call(target(id), signed(target(id)))).status).toBe(200);
  });

  test("verifier key not configured -> 503 SERVICE_AUTH_NOT_CONFIGURED; short key ignored", async () => {
    const id = await seed(TA, "submitted");
    for (const v of [undefined, `${KID}:tooshort`]) {
      if (v === undefined) delete process.env.SVC_SIGNING_KEYS_ACCOUNT_SERVICE;
      else process.env.SVC_SIGNING_KEYS_ACCOUNT_SERVICE = v;
      const r = await call(target(id), signed(target(id)));
      expect(r.status).toBe(503);
      expect(r.json.code).toBe("SERVICE_AUTH_NOT_CONFIGURED");
    }
  });

  test("key rotation: current and next kid both verify", async () => {
    const id = await seed(TA, "submitted");
    const next = crypto.randomBytes(32).toString("hex");
    process.env.SVC_SIGNING_KEYS_ACCOUNT_SERVICE = `${KID}:${SECRET},as-next:${next}`;
    expect((await call(target(id), signed(target(id)))).status).toBe(200);
    expect((await call(target(id), signed(target(id), { kid: "as-next", secret: next }))).status).toBe(200);
  });

  test("no user token accepted as a substitute (JWT, AUTH_BYPASS, x-internal-request, gateway identity)", async () => {
    const id = await seed(TA, "submitted");
    const token = jwt.sign({ id: "u1", sub: "u1", tenantId: TA, userType: "CRM", roles: ["SU"], permissions: ["*"] }, process.env.JWT_SECRET, { expiresIn: "1h" });
    const r1 = await call(target(id), { authorization: `Bearer ${token}`, "x-tenant-id": TA });
    expect(r1.status).toBe(401);
    expect(r1.json.code).toBe("SERVICE_AUTH_REQUIRED");
    const r2 = await call(target(id), { authorization: `Bearer ${token}`, "x-internal-request": "true", "x-tenant-id": TA });
    expect(r2.json.code).toBe("SERVICE_AUTH_REQUIRED");
    // Gateway identity headers (what the DEV gateway sets on every JWT location): not exposed -> 404,
    // with or without a valid signature.
    const gw = { "x-jwt-verified": "true", "x-auth-source": "gateway", "x-user-id": "u1", "x-user-type": "CRM", "x-tenant-id": TA };
    for (const h of [gw, { ...signed(target(id)), ...gw }]) {
      const r = await call(target(id), h);
      expect(r.status).toBe(404);
      expect(r.json.error).toBe("NOT_FOUND");
      expect(r.text).not.toContain("submitted");
    }
  });

  test("mode: off (and unset) = 503 kill switch; report rejects failures exactly like enforce", async () => {
    const id = await seed(TA, "submitted");
    for (const m of [undefined, "off", "garbage"]) {
      if (m === undefined) delete process.env.APPLICATION_STATE_SERVICE_AUTH_MODE;
      else process.env.APPLICATION_STATE_SERVICE_AUTH_MODE = m;
      const r = await call(target(id), signed(target(id)));
      expect(r.status).toBe(503);
      expect(r.json.code).toBe("APPLICATION_STATE_LOOKUP_DISABLED");
      const u = await call(target(id), { "x-tenant-id": TA });
      expect(u.status).toBe(503);
      // gateway-routed requests stay 404 even in off mode (the route is never revealed)
      const g = await call(target(id), { "x-jwt-verified": "true", "x-auth-source": "gateway", "x-user-id": "u1", "x-tenant-id": TA });
      expect(g.status).toBe(404);
    }
    process.env.APPLICATION_STATE_SERVICE_AUTH_MODE = "report";
    expect((await call(target(id), signed(target(id)))).status).toBe(200);
    const unsigned = await call(target(id), { "x-tenant-id": TA, "x-internal-request": "true" });
    expect(unsigned.status).toBe(401);
    expect(unsigned.json.code).toBe("SERVICE_AUTH_REQUIRED");
    const bad = await call(target(id), signed(target(id), { secret: crypto.randomBytes(32).toString("hex") }));
    expect(bad.status).toBe(401);
    expect(bad.json.code).toBe("SERVICE_AUTH_INVALID");
  });

  test("only GET on the exact path: POST/other paths under /api/internal -> 404, body on GET -> 401", async () => {
    const id = await seed(TA, "submitted");
    const post = await call(target(id), signed(target(id), { method: "POST" }), { method: "POST", body: "{}" });
    expect(post.status).toBe(404);
    for (const p of ["/api/internal/applications", `/api/internal/applications/${id}`, `/api/internal/applications/${id}/refund-state/`, `/api/internal/applications/${id}/Refund-State`]) {
      const r = await call(p, signed(p));
      expect(r.status).toBe(404);
    }
    // GET with a body is refused (the signature covers an EMPTY body)
    const http = require("http");
    const status = await new Promise((resolve, reject) => {
      const req = http.request(`${base}${target(id)}`, { method: "GET", headers: { ...signed(target(id)), "content-type": "application/json", "content-length": "2" } }, (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode, code: JSON.parse(buf).code }));
      });
      req.on("error", reject);
      req.end("{}");
    });
    expect(status).toEqual({ status: 401, code: "SERVICE_AUTH_MALFORMED" });
  });

  test("existing routes unchanged: /health public, globally-authenticated routes still refuse without a token, pre-auth /api/profile/internal still served", async () => {
    const health = await call("/health");
    expect(health.status).toBe(200);
    delete process.env.AUTH_BYPASS_ENABLED;
    // existing global authenticate behaviour: no token -> 400 "Authorization header required"
    const pd = await call("/api/personal-details");
    expect(pd.status).toBe(400);
    expect(pd.json.error.missingHeader).toBe(true);
    // the signature headers grant nothing on any other route
    const pd2 = await call("/api/applications", signed("/api/applications"));
    expect(pd2.status).toBe(400);
    expect(pd2.json.error.missingHeader).toBe(true);
    const internal = await call("/api/profile/internal/by-email?email=nobody%40example.com", { "x-internal-request": "true", "x-tenant-id": TA });
    expect(internal.status).not.toBe(404);
    expect(internal.status).toBeLessThan(500);
    const fallthrough = await call("/api/does-not-exist", { authorization: `Bearer ${jwt.sign({ id: "u1", tenantId: TA, userType: "CRM" }, process.env.JWT_SECRET)}` });
    expect(fallthrough.status).toBe(404);
  });

  test("status table is the documented one", () => {
    expect(STATUS).toMatchObject({
      SERVICE_AUTH_REQUIRED: 401, SERVICE_AUTH_MALFORMED: 401, SERVICE_AUTH_UNKNOWN_KID: 401, SERVICE_AUTH_STALE: 401,
      SERVICE_AUTH_INVALID: 401, SERVICE_AUTH_REPLAY: 401, SERVICE_NOT_ALLOWED: 403,
      SERVICE_AUTH_NOT_CONFIGURED: 503, SERVICE_AUTH_STORE_UNAVAILABLE: 503, APPLICATION_STATE_LOOKUP_DISABLED: 503,
    });
  });
});

describe("app.js mount order (source)", () => {
  test("/api/internal is mounted before the global authenticate and nowhere else", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
    const iInternal = src.indexOf('app.use("/api/internal", require("./routes/internal.routes"))');
    const iAuth = src.indexOf("app.use(authenticate)");
    expect(iInternal).toBeGreaterThan(-1);
    expect(iInternal).toBeLessThan(iAuth);
    expect(src.split('require("./routes/internal.routes")').length).toBe(2);
    const idx = fs.readFileSync(path.join(__dirname, "..", "routes", "index.js"), "utf8");
    expect(idx).not.toMatch(/internal\.routes/);
  });
});

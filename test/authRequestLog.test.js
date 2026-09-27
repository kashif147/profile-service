"use strict";
// Focused test: profile-service auth middleware emits a structured, correlation-tagged
// "Request context set" record (logging-lib) on the authenticated gateway path.
// Run: node --test test/authRequestLog.test.js
const os = require("os");
const path = require("path");
const fs = require("fs");
process.env.LOG_ROOT =
  process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "profile-authlog-"));
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const test = require("node:test");
const assert = require("node:assert");
const { authenticate } = require("../middlewares/auth.js");

async function captureAsync(fn) {
  const orig = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (s) => (chunks.push(typeof s === "string" ? s : s.toString()), true);
  try {
    await fn();
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
  return { raw: chunks.join(""), rows };
}

function gatewayReq(overrides = {}) {
  return {
    method: "GET",
    url: "/api/profile",
    originalUrl: "/api/profile",
    correlationId: "trace-123",
    headers: {
      "x-jwt-verified": "true",
      "x-auth-source": "gateway",
      "x-user-id": "U1",
      "x-tenant-id": "68cbf7806080b4621d469d34",
      "x-user-type": "CRM",
      "x-user-roles": '["REO"]',
      "x-user-permissions": "[]",
      "x-correlation-id": "trace-123",
      authorization: "Bearer eyJshould.not.belogged",
      cookie: "session=should-not-be-logged",
      ...(overrides.headers || {}),
    },
    ...overrides,
  };
}
const mkRes = () => {
  const r = { statusCode: null, body: null };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};

test("1 inbound correlationId appears in the structured request-context log", async () => {
  const req = gatewayReq();
  const res = mkRes();
  let nexted = false;
  const { rows } = await captureAsync(() =>
    authenticate(req, res, () => (nexted = true))
  );
  const row = rows.find((r) => r.eventType === "RequestContextSet");
  assert.ok(row, "RequestContextSet record emitted");
  assert.equal(row.correlationId, "trace-123");
  assert.equal(nexted, true, "next() called (context flow unchanged)");
});

test("2 tenantId + safe context fields are logged", async () => {
  const req = gatewayReq();
  const res = mkRes();
  const { rows } = await captureAsync(() => authenticate(req, res, () => {}));
  const row = rows.find((r) => r.eventType === "RequestContextSet");
  assert.equal(row.tenantId, "68cbf7806080b4621d469d34");
  assert.equal(row.userId, "U1");
  assert.equal(row.userType, "CRM");
  assert.equal(row.authSource, "gateway");
  assert.equal(row.method, "GET");
  assert.equal(row.path, "/api/profile");
  assert.ok(row.environment, "environment present");
  assert.equal(row.service, "profile-service");
});

test("3 no Authorization/JWT/cookie VALUES are logged (names as header keys are ok)", async () => {
  const req = gatewayReq();
  const res = mkRes();
  const { raw, rows } = await captureAsync(() => authenticate(req, res, () => {}));
  // The real risk is secret VALUES, never the raw token/cookie contents.
  for (const secretValue of ["Bearer eyJ", "eyJshould", "session=should-not-be-logged"]) {
    assert.ok(!raw.includes(secretValue), `must not log secret value: ${secretValue}`);
  }
  // The structured record itself must carry no auth/cookie/token fields.
  const row = rows.find((r) => r.eventType === "RequestContextSet");
  for (const k of ["authorization", "Authorization", "cookie", "token", "jwt", "password"]) {
    assert.ok(!(k in row), `structured record must not contain field ${k}`);
  }
});

test("4 existing request-context behavior unchanged (req.* set, next called)", async () => {
  const req = gatewayReq();
  const res = mkRes();
  let nexted = false;
  await captureAsync(() => authenticate(req, res, () => (nexted = true)));
  assert.equal(nexted, true);
  assert.equal(req.tenantId, "68cbf7806080b4621d469d34");
  assert.equal(req.userId, "U1");
  assert.deepEqual(req.roles, ["REO"]);
  assert.equal(res.statusCode, null, "no error response on valid gateway request");
});

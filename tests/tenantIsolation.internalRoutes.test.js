"use strict";
/**
 * Phase 2B (C-01 / C-02 / T-1 / T-2) — Tenant A/B isolation for the pre-auth
 * `/api/profile/internal/*` and `/api/profile/batch` routes.
 *
 * Drives the REAL routes/profile.routes.js router over HTTP (express + node
 * http, no supertest) with in-memory Profile/User models. Verifies:
 *   - internal-only calls are scoped to the caller's x-tenant-id header;
 *   - a body/query tenantId that disagrees is rejected (403), never used;
 *   - a user identity (gateway headers / verified JWT) wins over the internal
 *     x-tenant-id header;
 *   - relaxTenant=true is ignored;
 *   - getProfilesByUserIds requires a tenant and scopes both lookups;
 *   - the legitimate callers' request shapes (events-service, subscription-
 *     service, notification-service, user-service, issue/comm/audit) still work.
 */
const os = require("os");
const path = require("path");
const fs = require("fs");
const http = require("http");

process.env.LOG_ROOT =
  process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-internal-"));
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.JWT_SECRET = "phase2b-test-secret";

jest.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));
jest.mock("../models/profile.model.js", () =>
  require("./helpers/memoryModel").createMemoryModel("Profile"),
);
jest.mock("../models/user.model.js", () =>
  require("./helpers/memoryModel").createMemoryModel("User"),
);
// Duplicate-candidate scoring calls subscription-service; keep it offline.
jest.mock("../services/subscription.service.client.js", () => ({
  fetchCurrentSubscriptionByProfileId: jest.fn(async () => null),
}));

const express = require("express");
const jwt = require("jsonwebtoken");
const Profile = require("../models/profile.model.js");
const User = require("../models/user.model.js");
const profileRoutes = require("../routes/profile.routes");

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const PA = "a00000000000000000000001"; // tenant A profile
const PB = "b00000000000000000000001"; // tenant B profile
const UA = "a10000000000000000000001"; // tenant A synced user doc _id
const UB = "b10000000000000000000001";

let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/profile", profileRoutes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  Profile.reset();
  User.reset();
  Profile.seed([
    {
      _id: PA,
      tenantId: A,
      normalizedEmail: "shared@example.com",
      membershipNumber: null,
      userId: UA,
      isActive: true,
      personalInfo: { forename: "Alice", surname: "A" },
    },
    {
      _id: PB,
      tenantId: B,
      normalizedEmail: "shared@example.com",
      membershipNumber: null,
      userId: UB,
      isActive: true,
      personalInfo: { forename: "Bob", surname: "B" },
    },
  ]);
  User.seed([
    { _id: UA, userId: "portal-a", tenantId: A, userType: "PORTAL", isActive: true, userEmail: "shared@example.com" },
    { _id: UB, userId: "portal-b", tenantId: B, userType: "PORTAL", isActive: true, userEmail: "shared@example.com" },
  ]);
});

function call(method, urlPath, { headers = {}, body } = {}) {
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

const internal = (tenant) => ({
  "x-internal-request": "true",
  ...(tenant ? { "x-tenant-id": tenant } : {}),
});
const bearer = (tenant) => ({
  authorization: `Bearer ${jwt.sign({ sub: "user-1", tenantId: tenant, userType: "CRM" }, process.env.JWT_SECRET)}`,
});
const gateway = (tenant) => ({
  "x-jwt-verified": "true",
  "x-auth-source": "gateway",
  "x-user-id": "gw-user",
  "x-tenant-id": tenant,
});

describe("/profile/batch (C-02, relaxTenant removed)", () => {
  test("A internal caller sees only A's profiles even when asking for B's id", async () => {
    const r = await call("POST", "/api/profile/batch", {
      headers: internal(A),
      body: { profileIds: [PA, PB] },
    });
    expect(r.status).toBe(200);
    expect(r.body.data.map((p) => p._id)).toEqual([PA]);
  });

  test("B cannot read A's profile by id", async () => {
    const r = await call("POST", "/api/profile/batch", {
      headers: internal(B),
      body: { profileIds: [PA] },
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
  });

  test("relaxTenant=true is ignored (internal and JWT)", async () => {
    const r1 = await call("POST", "/api/profile/batch?relaxTenant=true", {
      headers: internal(B),
      body: { profileIds: [PA, PB] },
    });
    expect(r1.body.data.map((p) => p._id)).toEqual([PB]);
    const r2 = await call("POST", "/api/profile/batch?relaxTenant=1", {
      headers: { ...bearer(A), "x-internal-request": "true" },
      body: { profileIds: [PA, PB] },
    });
    expect(r2.body.data.map((p) => p._id)).toEqual([PA]);
  });

  test("JWT tenant wins over an internal x-tenant-id header", async () => {
    const r = await call("POST", "/api/profile/batch", {
      headers: { ...bearer(A), ...internal(B) },
      body: { profileIds: [PA, PB] },
    });
    expect(r.status).toBe(200);
    expect(r.body.data.map((p) => p._id)).toEqual([PA]);
  });

  test("gateway identity is honoured (CRM aggregation through the gateway)", async () => {
    const r = await call("GET", `/api/profile/batch?profileIds=${PA},${PB}`, {
      headers: gateway(B),
    });
    expect(r.status).toBe(200);
    expect(r.body.data.map((p) => p._id)).toEqual([PB]);
  });

  test("body/query tenantId override is rejected, not used", async () => {
    const r = await call("POST", `/api/profile/batch?tenantId=${A}`, {
      headers: internal(B),
      body: { profileIds: [PA] },
    });
    expect(r.status).toBe(403);
    const r2 = await call("POST", "/api/profile/batch", {
      headers: bearer(B),
      body: { profileIds: [PA], tenantId: A },
    });
    expect(r2.status).toBe(403);
  });

  test("no identity and no internal flag -> 401; invalid JWT without internal flag -> 401", async () => {
    expect((await call("POST", "/api/profile/batch", { body: { profileIds: [PA] } })).status).toBe(401);
    const r = await call("POST", "/api/profile/batch", {
      headers: { authorization: "Bearer not-a-jwt" },
      body: { profileIds: [PA] },
    });
    expect(r.status).toBe(401);
  });

  test("an expired/invalid JWT replayed with internal headers falls back to the internal tenant only", async () => {
    const r = await call("POST", "/api/profile/batch", {
      headers: { authorization: "Bearer not-a-jwt", ...internal(B) },
      body: { profileIds: [PA, PB] },
    });
    expect(r.status).toBe(200);
    expect(r.body.data.map((p) => p._id)).toEqual([PB]);
  });

  test("every Profile.find issued carries the resolved tenant", async () => {
    await call("POST", "/api/profile/batch?relaxTenant=true", {
      headers: internal(A),
      body: { profileIds: [PA, PB] },
    });
    const finds = Profile.calls.filter((c) => c.op === "find");
    expect(finds.length).toBeGreaterThan(0);
    for (const f of finds) expect(f.filter.tenantId).toBe(A);
  });
});

describe("/profile/internal/by-email (user-service membership check)", () => {
  test("internal caller sees only its own tenant", async () => {
    const r = await call("GET", "/api/profile/internal/by-email?email=shared@example.com", {
      headers: internal(B),
    });
    expect(r.status).toBe(200);
    expect(r.body.data.profileId).toBe(PB);
  });

  test("query tenant disagreeing with x-tenant-id is rejected", async () => {
    const r = await call(
      "GET",
      `/api/profile/internal/by-email?email=shared@example.com&tenantId=${A}`,
      { headers: internal(B) },
    );
    expect(r.status).toBe(403);
  });

  test("user-service shape (x-internal-request + ?tenantId, no x-tenant-id) still works, scoped", async () => {
    const r = await call(
      "GET",
      `/api/profile/internal/by-email?email=shared@example.com&tenantId=${A}`,
      { headers: { "x-internal-request": "true" } },
    );
    expect(r.status).toBe(200);
    expect(r.body.data.profileId).toBe(PA);
  });

  test("a user JWT without the internal flag cannot use internal routes", async () => {
    const r = await call("GET", "/api/profile/internal/by-email?email=shared@example.com", {
      headers: bearer(A),
    });
    expect(r.status).toBe(403);
  });

  test("user JWT + internal flag: user tenant wins, internal header grants nothing", async () => {
    const r = await call("GET", "/api/profile/internal/by-email?email=shared@example.com", {
      headers: { ...bearer(A), ...internal(B) },
    });
    expect(r.status).toBe(200);
    expect(r.body.data.profileId).toBe(PA);
  });
});

describe("/profile/internal/by-user-ids (notification-service)", () => {
  test("internal with tenant: only that tenant's profiles are mapped", async () => {
    const r = await call("POST", "/api/profile/internal/by-user-ids", {
      headers: internal(A),
      body: { userIds: ["portal-a", "portal-b", UA, UB] },
    });
    expect(r.status).toBe(200);
    const ids = Object.values(r.body.data).map((p) => String(p._id));
    expect(new Set(ids)).toEqual(new Set([PA]));
  });

  test("forwarded JWT (notification-service default path) scopes to the JWT tenant", async () => {
    const r = await call("POST", "/api/profile/internal/by-user-ids", {
      headers: bearer(B),
      body: { userIds: ["portal-a", "portal-b"] },
    });
    expect(r.status).toBe(200);
    const ids = Object.values(r.body.data).map((p) => String(p._id));
    expect(new Set(ids)).toEqual(new Set([PB]));
  });

  test("internal with no tenant at all is refused (tenant required)", async () => {
    const r = await call("POST", "/api/profile/internal/by-user-ids", {
      headers: internal(null),
      body: { userIds: ["portal-a"] },
    });
    expect(r.status).toBe(400);
  });

  test("both User and Profile lookups are tenant-filtered", async () => {
    await call("POST", "/api/profile/internal/by-user-ids", {
      headers: internal(B),
      body: { userIds: ["portal-a", UA] },
    });
    for (const c of User.calls.filter((x) => x.op === "find")) expect(c.filter.tenantId).toBe(B);
    for (const c of Profile.calls.filter((x) => x.op === "find")) expect(c.filter.tenantId).toBe(B);
  });
});

describe("/profile/internal attendee routes (events-service)", () => {
  test("rollback: B cannot delete A's profile (body tenant A rejected; header B scopes)", async () => {
    const r1 = await call("POST", "/api/profile/internal/rollback-attendee-profile", {
      headers: internal(B),
      body: { tenantId: A, profileId: PA },
    });
    expect(r1.status).toBe(403);
    const r2 = await call("POST", "/api/profile/internal/rollback-attendee-profile", {
      headers: internal(B),
      body: { tenantId: B, profileId: PA },
    });
    expect(r2.status).toBe(200);
    expect(r2.body.data).toEqual({ deleted: false, reason: "not_found" });
    expect(Profile.all().map((p) => p._id)).toContain(PA);
  });

  test("rollback: A can delete its own membership-less attendee profile (events-service shape)", async () => {
    const r = await call("POST", "/api/profile/internal/rollback-attendee-profile", {
      headers: internal(A),
      body: { tenantId: A, profileId: PA },
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ deleted: true });
    expect(Profile.all().map((p) => p._id)).toEqual([PB]);
  });

  test("fields-update: B cannot change A's profile", async () => {
    const r = await call("POST", "/api/profile/internal/attendee-profile-fields-update", {
      headers: internal(B),
      body: { tenantId: B, profileId: PA, firstName: "Mallory" },
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ updated: false, reason: "not_found" });
    expect(Profile.all().find((p) => p._id === PA).personalInfo.forename).toBe("Alice");
  });

  test("fields-update with a body tenant that disagrees is rejected", async () => {
    const r = await call("POST", "/api/profile/internal/attendee-profile-fields-update", {
      headers: internal(B),
      body: { tenantId: A, profileId: PA, firstName: "Mallory" },
    });
    expect(r.status).toBe(403);
    expect(Profile.all().find((p) => p._id === PA).personalInfo.forename).toBe("Alice");
  });

  test("fields-sync: body tenant override rejected", async () => {
    const r = await call("POST", "/api/profile/internal/attendee-profile-fields-sync", {
      headers: internal(B),
      body: { tenantId: A, profileId: PA, nmbiNumber: "X1" },
    });
    expect(r.status).toBe(403);
  });

  test("find-or-create: returns the caller tenant's profile, never another tenant's", async () => {
    const r = await call("POST", "/api/profile/internal/find-or-create-attendee", {
      headers: internal(B),
      body: { tenantId: B, email: "shared@example.com", firstName: "Bob", lastName: "B" },
    });
    expect(r.status).toBe(200);
    expect(r.body.data.profileId).toBe(PB);
    expect(r.body.data.created).toBe(false);
  });

  test("find-or-create: body tenant A with header B is rejected", async () => {
    const r = await call("POST", "/api/profile/internal/find-or-create-attendee", {
      headers: internal(B),
      body: { tenantId: A, email: "shared@example.com" },
    });
    expect(r.status).toBe(403);
  });

  test("no x-internal-request -> 403 on every attendee route", async () => {
    for (const p of [
      "find-or-create-attendee",
      "attendee-duplicate-check",
      "rollback-attendee-profile",
      "attendee-profile-fields-sync",
      "attendee-profile-fields-update",
    ]) {
      const r = await call("POST", `/api/profile/internal/${p}`, {
        headers: { "x-tenant-id": A },
        body: { tenantId: A, profileId: PA, email: "shared@example.com" },
      });
      expect(r.status).toBe(403);
    }
  });
});

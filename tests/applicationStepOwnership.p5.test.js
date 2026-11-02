"use strict";
/**
 * P5 portal object authorization - application-step routes (batch 2).
 *
 * Real routers + REAL controllers / services / handlers for /personal-details,
 * /professional-details and /subscription-details, with the Mongoose models replaced by the
 * in-memory model (no DB), so every assertion covers both the gate and what actually happened to
 * the stored records:
 *   A    portal member, tenant TA, own application APP_A          -> allowed
 *   B    portal member, tenant TA, application APP_B              -> A on B denied, B unchanged
 *   C    portal member, tenant TB, application APP_C              -> A on C denied, C unchanged
 *   K    CRM-created application in TA (userId null)              -> unknown caller type denied
 *   CRM + permission -> allowed (tenant-scoped); CRM without permission -> denied.
 * Portal tokens carry every portal:* code, so a denial proves the ownership / caller-type gate,
 * not a missing permission. The PDP is mocked as "permit iff resource:action is in the token".
 */
const os = require("os");
const path = require("path");
const fs = require("fs");
const http = require("http");

process.env.LOG_ROOT = process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-p5b2-"));
process.env.JWT_SECRET = "p5-app-step-test-secret";

jest.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));
jest.mock("../models/personal.details.model", () =>
  require("./helpers/memoryModel").createMemoryModel("PersonalDetails"),
);
jest.mock("../models/personal.details.model.js", () =>
  require("./helpers/memoryModel").createMemoryModel("PersonalDetails"),
);
jest.mock("../models/professional.details.model", () =>
  require("./helpers/memoryModel").createMemoryModel("ProfessionalDetails"),
);
jest.mock("../models/subscription.model", () =>
  require("./helpers/memoryModel").createMemoryModel("SubscriptionDetails"),
);
jest.mock("../models/profile.model.js", () =>
  require("./helpers/memoryModel").createMemoryModel("Profile"),
);
jest.mock("../models/user.model.js", () =>
  require("./helpers/memoryModel").createMemoryModel("User"),
);
jest.mock("../services/duplicate.detection.service.js", () => ({ queueDuplicateDetection: jest.fn() }));
jest.mock("../config/bizLogger.js", () => ({ business: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../middlewares/policy.middleware", () => {
  const requirePermission = (resource, action) => (req, res, next) => {
    const perms = (req.user && req.user.permissions) || [];
    if (perms.includes(`${resource}:${action}`)) return next();
    return res.status(403).json({ code: "PDP_DENY" });
  };
  const m = { requirePermission };
  return { defaultPolicyMiddleware: m, ...m };
});

const express = require("express");
const jwt = require("jsonwebtoken");
// Both specifiers resolve to the same module path, so jest hands out one shared instance.
const PersonalDetails = require("../models/personal.details.model");
const ProfessionalDetails = require("../models/professional.details.model");
const SubscriptionDetails = require("../models/subscription.model");

const TA = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TB = "bbbbbbbbbbbbbbbbbbbbbbbb";
const SA = "a20000000000000000000001"; // user-service ids (token sub)
const SB = "a20000000000000000000002";
const SC = "b20000000000000000000003";
const SD = "a20000000000000000000004"; // portal member with no application yet
const CRM_ID = "c00000000000000000000009";
const APP_A = "app-a-0001";
const APP_B = "app-b-0001";
const APP_C = "app-c-0001";
const APP_K = "app-k-0001"; // CRM-created, PersonalDetails.userId null
const APP_MISSING = "app-x-9999";

const PORTAL_PERMS = ["portal:read", "portal:write", "portal:create", "portal:delete"];
const CRM_PERMS = ["portal:read", "portal:write", "portal:create", "portal:delete"];

const token = (claims) => `Bearer ${jwt.sign(claims, process.env.JWT_SECRET)}`;
const asA = { authorization: token({ sub: SA, tenantId: TA, userType: "PORTAL", permissions: PORTAL_PERMS }) };
const asD = { authorization: token({ sub: SD, tenantId: TA, userType: "PORTAL", permissions: PORTAL_PERMS }) };
const asCrm = { authorization: token({ sub: CRM_ID, tenantId: TA, userType: "CRM", permissions: CRM_PERMS }) };
const asCrmNoPerm = { authorization: token({ sub: CRM_ID, tenantId: TA, userType: "CRM", permissions: [] }) };
const asUnknownType = { authorization: token({ sub: SA, tenantId: TA, userType: "MEMBERX", permissions: PORTAL_PERMS }) };

let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(require("../middlewares/response.mw"));
  const { authenticate } = require("../middlewares/auth");
  app.use("/api/personal-details", authenticate, require("../routes/personal.details.routes"));
  app.use("/api/professional-details", authenticate, require("../routes/professional.details.routes"));
  app.use("/api/subscription-details", authenticate, require("../routes/subscription.details.routes"));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) =>
    res.status(err.status || err.statusCode || 500).json({ code: err.code, error: err.message }),
  );
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

function personal(tenantId, applicationId, userId, tag) {
  return {
    tenantId,
    applicationId,
    userId,
    applicationStatus: "in-progress",
    personalInfo: { forename: `F-${tag}`, surname: `S-${tag}` },
    contactInfo: { personalEmail: `${tag}@example.invalid` },
    meta: { userType: userId ? "PORTAL" : "CRM", isActive: true, deleted: false },
  };
}
function professional(tenantId, applicationId, userId, tag) {
  return {
    tenantId,
    applicationId,
    userId,
    professionalDetails: { grade: `G-${tag}`, workLocation: `W-${tag}`, previousMembershipNo: `PM-${tag}` },
    meta: { isActive: true, deleted: false },
  };
}
function subscription(tenantId, applicationId, userId, tag) {
  return {
    tenantId,
    applicationId,
    userId,
    subscriptionDetails: { payrollNo: `P-${tag}`, membershipCategory: `cat-${tag}`, youthForum: `YF-${tag}` },
    meta: { isActive: true, deleted: false },
  };
}

const APPS = [
  [TA, APP_A, SA, "a"],
  [TA, APP_B, SB, "b"],
  [TB, APP_C, SC, "c"],
  [TA, APP_K, null, "k"],
];

function seed({ withProfessional = true, withSubscription = true } = {}) {
  PersonalDetails.reset();
  ProfessionalDetails.reset();
  SubscriptionDetails.reset();
  PersonalDetails.seed(APPS.map((a) => personal(...a)));
  if (withProfessional) ProfessionalDetails.seed(APPS.map((a) => professional(...a)));
  if (withSubscription) SubscriptionDetails.seed(APPS.map((a) => subscription(...a)));
}

/** Every stored record (all three step collections) belonging to an application. */
function recordsOf(applicationId) {
  const of = (M) => M.all().filter((d) => d.applicationId === applicationId);
  return JSON.stringify({
    personal: of(PersonalDetails),
    professional: of(ProfessionalDetails),
    subscription: of(SubscriptionDetails),
  });
}

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  seed();
});
afterEach(() => jest.restoreAllMocks());

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

const denied = (r, code) => r.status === 403 && (!code || (r.body && r.body.code === code));

// Bodies valid for the Joi schemas. The subscription body carries the legacy professional fields
// (previousMembershipNo / youthForum), which the controller syncs into ProfessionalDetails.
const BODIES = {
  personalUpdate: { personalInfo: { forename: "Changed" } },
  professional: { professionalDetails: { grade: "G-changed", nmbiNumber: "N-1" } },
  subscription: { subscriptionDetails: { payrollNo: "P-changed", previousMembershipNo: "PM-injected", youthForum: "YF-injected" } },
};

/**
 * [label, method, url(appId), body, seedOpts, verifyOwn(appId)] for every application-keyed
 * step operation. seedOpts drops the step being created so create starts from "not yet there".
 */
const OPS = [
  ["personal read", "GET", (id) => `/api/personal-details/${id}`, undefined, {}, (r) => r.body.data.applicationId === APP_A],
  ["personal status", "GET", (id) => `/api/personal-details/${id}/status`, undefined, {}, (r) => r.body.data.applicationStatus === "in-progress"],
  ["personal update", "PUT", (id) => `/api/personal-details/${id}`, BODIES.personalUpdate, {},
    () => PersonalDetails.all().find((d) => d.applicationId === APP_A).personalInfo.forename === "Changed"],
  ["personal delete", "DELETE", (id) => `/api/personal-details/${id}`, undefined, {},
    () => !PersonalDetails.all().some((d) => d.applicationId === APP_A)],
  ["professional create", "POST", (id) => `/api/professional-details/${id}`, BODIES.professional, { withProfessional: false },
    () => ProfessionalDetails.all().some((d) => d.applicationId === APP_A && String(d.userId) === SA)],
  ["professional read", "GET", (id) => `/api/professional-details/${id}`, undefined, {}, (r) => r.body.data.applicationId === APP_A],
  ["professional update", "PUT", (id) => `/api/professional-details/${id}`, BODIES.professional, {},
    () => ProfessionalDetails.all().find((d) => d.applicationId === APP_A).professionalDetails.grade === "G-changed"],
  ["professional delete", "DELETE", (id) => `/api/professional-details/${id}`, undefined, {},
    () => !ProfessionalDetails.all().some((d) => d.applicationId === APP_A)],
  ["subscription create", "POST", (id) => `/api/subscription-details/${id}`, BODIES.subscription, { withSubscription: false },
    () => SubscriptionDetails.all().some((d) => d.applicationId === APP_A && String(d.userId) === SA)],
  ["subscription create-over-existing", "POST", (id) => `/api/subscription-details/${id}`, BODIES.subscription, {},
    () => SubscriptionDetails.all().find((d) => d.applicationId === APP_A).subscriptionDetails.payrollNo === "P-changed"],
  ["subscription read", "GET", (id) => `/api/subscription-details/${id}`, undefined, {}, (r) => r.body.data.applicationId === APP_A],
  ["subscription update", "PUT", (id) => `/api/subscription-details/${id}`, BODIES.subscription, {},
    () => SubscriptionDetails.all().find((d) => d.applicationId === APP_A).subscriptionDetails.payrollNo === "P-changed"],
  ["subscription delete", "DELETE", (id) => `/api/subscription-details/${id}`, undefined, {},
    () => !SubscriptionDetails.all().some((d) => d.applicationId === APP_A)],
];

describe.each(OPS)("P5 application step: %s", (_label, method, url, body, seedOpts, verifyOwn) => {
  beforeEach(() => seed(seedOpts));

  test("A on own application: allowed and applied", async () => {
    const r = await call(method, url(APP_A), asA, body);
    expect(r.status).toBe(200);
    expect(verifyOwn(r)).toBe(true);
  });

  test("A on B (same tenant): 403 NOT_OWNER and B's records unchanged", async () => {
    const before = recordsOf(APP_B);
    const r = await call(method, url(APP_B), asA, body);
    expect(denied(r, "NOT_OWNER")).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain("F-b");
    expect(recordsOf(APP_B)).toBe(before);
  });

  test("A on C (other tenant): 403 NOT_OWNER and C's records unchanged", async () => {
    const before = recordsOf(APP_C);
    const r = await call(method, url(APP_C), asA, body);
    expect(denied(r, "NOT_OWNER")).toBe(true);
    expect(recordsOf(APP_C)).toBe(before);
  });

  test("A on a missing application: the same 403 NOT_OWNER (no existence leak)", async () => {
    const r = await call(method, url(APP_MISSING), asA, body);
    expect(denied(r, "NOT_OWNER")).toBe(true);
  });

  test("A on a CRM-created application (userId null): 403 NOT_OWNER, unchanged", async () => {
    const before = recordsOf(APP_K);
    const r = await call(method, url(APP_K), asA, body);
    expect(denied(r, "NOT_OWNER")).toBe(true);
    expect(recordsOf(APP_K)).toBe(before);
  });

  test("CRM + permission on B: allowed (tenant-scoped)", async () => {
    const r = await call(method, url(APP_B), asCrm, body);
    expect(r.status).toBe(200);
    // ...but never another tenant's application.
    const beforeC = recordsOf(APP_C);
    const rc = await call(method, url(APP_C), asCrm, body);
    expect(recordsOf(APP_C)).toBe(beforeC);
    if (rc.status === 200) expect(rc.body.data == null || typeof rc.body.data === "string").toBe(true);
  });

  test("CRM without permission: denied, B unchanged", async () => {
    const before = recordsOf(APP_B);
    const r = await call(method, url(APP_B), asCrmNoPerm, body);
    expect(denied(r, "PDP_DENY")).toBe(true);
    expect(recordsOf(APP_B)).toBe(before);
  });

  test("unknown caller type (with every portal permission): 403 CRM_ONLY, CRM-created record unchanged", async () => {
    const before = recordsOf(APP_K);
    const r = await call(method, url(APP_K), asUnknownType, body);
    expect(denied(r, "CRM_ONLY")).toBe(true);
    expect(recordsOf(APP_K)).toBe(before);
  });
});

describe("P5 application step: subscription legacy-field sync cannot reach another member's professional details", () => {
  test.each([["POST"], ["PUT"]])("%s /subscription-details/APP_B as A", async (method) => {
    const before = recordsOf(APP_B);
    const r = await call(method, `/api/subscription-details/${APP_B}`, asA, BODIES.subscription);
    expect(denied(r, "NOT_OWNER")).toBe(true);
    const prof = ProfessionalDetails.all().find((d) => d.applicationId === APP_B);
    expect(prof.professionalDetails.previousMembershipNo).toBe("PM-b");
    expect(recordsOf(APP_B)).toBe(before);
  });
});

describe("P5 application step: POST /personal-details (create the application root)", () => {
  const body = { personalInfo: { forename: "New" }, contactInfo: { personalEmail: "d@example.invalid" } };

  test("portal member without an application: created and bound to the verified user", async () => {
    const r = await call("POST", "/api/personal-details", asD, body);
    expect(r.status).toBe(200);
    const created = PersonalDetails.all().filter((d) => String(d.userId) === SD);
    expect(created).toHaveLength(1);
    expect(created[0].tenantId).toBe(TA);
  });

  test("portal member cannot set userId / tenantId / applicationId in the body", async () => {
    for (const extra of [{ userId: SB }, { tenantId: TB }, { applicationId: APP_B }]) {
      const before = JSON.stringify(PersonalDetails.all());
      const r = await call("POST", "/api/personal-details", asD, { ...body, ...extra });
      expect(r.status).toBe(400);
      expect(JSON.stringify(PersonalDetails.all())).toBe(before);
    }
  });

  test("A with an active application gets 409, nothing created", async () => {
    const before = JSON.stringify(PersonalDetails.all());
    const r = await call("POST", "/api/personal-details", asA, body);
    expect(r.status).toBe(409);
    expect(JSON.stringify(PersonalDetails.all())).toBe(before);
  });

  test("CRM + permission: created in the caller's tenant", async () => {
    const r = await call("POST", "/api/personal-details", asCrm, {
      personalInfo: { forename: "Crm" },
      contactInfo: { personalEmail: "crm-new@example.invalid" },
    });
    expect(r.status).toBe(200);
    const created = PersonalDetails.all().find((d) => d.contactInfo && d.contactInfo.personalEmail === "crm-new@example.invalid");
    expect(created.tenantId).toBe(TA);
  });

  test("CRM without permission and unknown caller type: denied, nothing created", async () => {
    const before = JSON.stringify(PersonalDetails.all());
    expect(denied(await call("POST", "/api/personal-details", asCrmNoPerm, body), "PDP_DENY")).toBe(true);
    expect(denied(await call("POST", "/api/personal-details", asUnknownType, body), "CRM_ONLY")).toBe(true);
    expect(JSON.stringify(PersonalDetails.all())).toBe(before);
  });
});

describe("P5 application step: POST /personal-details/check-email is CRM-only", () => {
  test("portal A probing B's email: 403 CRM_ONLY, no B data returned", async () => {
    const r = await call("POST", "/api/personal-details/check-email", asA, { email: "b@example.invalid" });
    expect(denied(r, "CRM_ONLY")).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain("F-b");
  });

  test("unknown caller type: 403 CRM_ONLY", async () => {
    const r = await call("POST", "/api/personal-details/check-email", asUnknownType, { email: "b@example.invalid" });
    expect(denied(r, "CRM_ONLY")).toBe(true);
  });

  test("CRM + permission: finds B in its own tenant, not C in another tenant", async () => {
    const rb = await call("POST", "/api/personal-details/check-email", asCrm, { email: "b@example.invalid" });
    expect(rb.status).toBe(200);
    expect(rb.body.data.exists).toBe(true);
    expect(rb.body.data.application.applicationId).toBe(APP_B);
    const rc = await call("POST", "/api/personal-details/check-email", asCrm, { email: "c@example.invalid" });
    expect(rc.status).toBe(200);
    expect(rc.body.data.exists).toBe(false);
  });

  test("CRM without permission: denied", async () => {
    const r = await call("POST", "/api/personal-details/check-email", asCrmNoPerm, { email: "b@example.invalid" });
    expect(denied(r, "PDP_DENY")).toBe(true);
  });
});

describe.each([
  ["personal", "/api/personal-details"],
  ["professional", "/api/professional-details"],
  ["subscription", "/api/subscription-details"],
])("P5 application step: GET %s 'my details' binds to the verified user", (_n, url) => {
  test("A gets only A's record", async () => {
    const r = await call("GET", url, asA);
    expect(r.status).toBe(200);
    expect(r.body.data.applicationId).toBe(APP_A);
    expect(String(r.body.data.userId)).toBe(SA);
  });

  test("portal member without an application gets no record (not someone else's)", async () => {
    const r = await call("GET", url, asD);
    expect(r.status).toBe(200);
    expect(r.body.data).toBeNull();
  });

  test("CRM gets no record; CRM without permission and unknown caller type are denied", async () => {
    const r = await call("GET", url, asCrm);
    expect(r.status).toBe(200);
    expect(r.body.data).toBeNull();
    expect(denied(await call("GET", url, asCrmNoPerm), "PDP_DENY")).toBe(true);
    expect(denied(await call("GET", url, asUnknownType), "CRM_ONLY")).toBe(true);
  });
});

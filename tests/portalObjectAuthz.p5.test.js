"use strict";
/**
 * P5 portal object authorization (PRE-UAT SECURITY BLOCKER - portal member object authorization).
 *
 * Route-level A/B/C matrix over the REAL routers (profile, applications, payment forms) with the
 * controllers replaced by sentinels, so each assertion is about the authorization gate alone:
 *   A  portal member, tenant TA, own profile PA      -> allowed where intended
 *   B  portal member, tenant TA, profile PB          -> A on B denied (same-tenant object)
 *   C  portal member, tenant TB, profile PC          -> A on C denied (other tenant)
 *   CRM + permission                                  -> allowed
 *   CRM without permission                            -> denied
 * The portal tokens carry every MEMBER/NON-MEMBER-style permission (profile:*, portal:*,
 * application:*, payments:*), so a denial proves the caller-type / ownership gate, not a missing
 * permission. The PDP is mocked as "permit iff the exact resource:action is in the token".
 */
const os = require("os");
const path = require("path");
const fs = require("fs");
const http = require("http");

process.env.LOG_ROOT = process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-p5-"));
process.env.JWT_SECRET = "p5-authz-test-secret";

jest.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));
jest.mock("../models/profile.model.js", () =>
  require("./helpers/memoryModel").createMemoryModel("Profile"),
);
jest.mock("../models/user.model.js", () =>
  require("./helpers/memoryModel").createMemoryModel("User"),
);
jest.mock("../middlewares/policy.middleware", () => {
  const requirePermission = (resource, action) => (req, res, next) => {
    const perms = (req.user && req.user.permissions) || [];
    if (perms.includes(`${resource}:${action}`)) return next();
    return res.status(403).json({ code: "PDP_DENY" });
  };
  const m = { requirePermission };
  return { defaultPolicyMiddleware: m, ...m };
});
jest.mock("../middlewares/idempotency.js", () => ({ idempotency: () => (req, res, next) => next() }));
jest.mock("../middlewares/validate.js", () => ({ validate: () => (req, res, next) => next() }));

// Sentinel controllers: reaching one means the gate admitted the request.
function mockSentinelModule() {
  return new Proxy(
    {},
    {
      get: (_t, key) =>
        key === "__esModule"
          ? false
          : (req, res) => res.status(200).json({ reached: String(key) }),
    },
  );
}
jest.mock("../controllers/profile.controller.js", () => mockSentinelModule());
jest.mock("../controllers/profile.validation.controller.js", () => mockSentinelModule());
jest.mock("../controllers/profile.duplicateReview.controller.js", () => mockSentinelModule());
jest.mock("../controllers/aggregated.user.details.controller.js", () => mockSentinelModule());
jest.mock("../controllers/profileApproval.controller.js", () => mockSentinelModule());
jest.mock("../controllers/bulkApproval.controller.js", () => mockSentinelModule());
jest.mock("../controllers/executiveCouncilApproval.controller.js", () => mockSentinelModule());
jest.mock("../controllers/duplicateReview.controller.js", () => mockSentinelModule());
jest.mock("../controllers/overlay.controller.js", () => mockSentinelModule());
jest.mock("../controllers/application.controller", () => mockSentinelModule());
jest.mock("../controllers/paymentForm.controller.js", () => mockSentinelModule());

const express = require("express");
const jwt = require("jsonwebtoken");
const Profile = require("../models/profile.model.js");
const User = require("../models/user.model.js");

const TA = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TB = "bbbbbbbbbbbbbbbbbbbbbbbb";
const PA = "a00000000000000000000001";
const PB = "a00000000000000000000002";
const PC = "b00000000000000000000003";
const LA = "a10000000000000000000001"; // local synced User._id
const LB = "a10000000000000000000002";
const LC = "b10000000000000000000003";
const SA = "a20000000000000000000001"; // user-service ids (token sub)
const SB = "a20000000000000000000002";
const SC = "b20000000000000000000003";
const CRM_ID = "c00000000000000000000009";
const APP_B = "app-b-0001";
const FORM_B = "f00000000000000000000002";

const PORTAL_PERMS = [
  "profile:read", "profile:write", "profile:delete", "profile:create",
  "portal:read", "portal:write", "portal:create", "portal:delete",
  "application:read", "application:write", "application:create", "application:delete",
  "payments:read", "payments:write", "payments:create",
];
const CRM_PERMS = [
  "profile:read", "profile:write", "profile:delete",
  "application:read", "application:write",
  "payments:read", "payments:write",
  "portal:read", "portal:write",
];

const token = (claims) => `Bearer ${jwt.sign(claims, process.env.JWT_SECRET)}`;
const asA = { authorization: token({ sub: SA, tenantId: TA, userType: "PORTAL", permissions: PORTAL_PERMS }) };
const asC = { authorization: token({ sub: SC, tenantId: TB, userType: "PORTAL", permissions: PORTAL_PERMS }) };
const asCrm = { authorization: token({ sub: CRM_ID, tenantId: TA, userType: "CRM", permissions: CRM_PERMS }) };
const asCrmNoPerm = { authorization: token({ sub: CRM_ID, tenantId: TA, userType: "CRM", permissions: [] }) };
const asUnknownType = { authorization: token({ sub: SA, tenantId: TA, userType: "MEMBERX", permissions: PORTAL_PERMS }) };
const internal = (tenant) => ({ "x-internal-request": "true", "x-tenant-id": tenant });

let server;
let baseUrl;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/profile", require("../routes/profile.routes"));
  const { authenticate } = require("../middlewares/auth");
  app.use("/api/applications", authenticate, require("../routes/application.routes"));
  app.use("/api/applications", authenticate, require("../routes/applications.routes"));
  app.use("/api/payment-forms", authenticate, require("../routes/paymentForm.routes"));
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
  Profile.reset();
  User.reset();
  Profile.seed([
    { _id: PA, tenantId: TA, userId: LA, isActive: true, membershipNumber: "A001" },
    { _id: PB, tenantId: TA, userId: LB, isActive: true, membershipNumber: "B001" },
    { _id: PC, tenantId: TB, userId: LC, isActive: true, membershipNumber: "C001" },
  ]);
  User.seed([
    { _id: LA, userId: SA, tenantId: TA, userType: "PORTAL", isActive: true },
    { _id: LB, userId: SB, tenantId: TA, userType: "PORTAL", isActive: true },
    { _id: LC, userId: SC, tenantId: TB, userType: "PORTAL", isActive: true },
  ]);
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
const denied = (r, code) => r.status === 403 && (!code || (r.body && r.body.code === code));

describe("P5 profile: list / search / grid are CRM + permission", () => {
  const routes = [
    ["GET", "/api/profile", undefined],
    ["GET", "/api/profile/search?q=x", undefined],
    ["PUT", "/api/profile/filter", {}],
    ["GET", "/api/profile/check-email?email=x@invalid.test", undefined],
    ["GET", "/api/profile/corn-market/new", undefined],
    ["GET", "/api/profile/corn-market/graduate", undefined],
  ];
  test.each(routes)("%s %s", async (method, url, body) => {
    expect(denied(await call(method, url, asA, body), "CRM_ONLY")).toBe(true);
    expect(denied(await call(method, url, asUnknownType, body), "CRM_ONLY")).toBe(true);
    expect(reached(await call(method, url, asCrm, body))).toBe(true);
    expect(denied(await call(method, url, asCrmNoPerm, body), "PDP_DENY")).toBe(true);
  });
});

describe("P5 profile: get / update by id", () => {
  test.each([
    ["GET", "read"],
    ["PUT", "write"],
  ])("%s /:profileId", async (method) => {
    const body = method === "PUT" ? { contactInfo: {} } : undefined;
    expect(reached(await call(method, `/api/profile/${PA}`, asA, body))).toBe(true); // A on A
    expect(denied(await call(method, `/api/profile/${PB}`, asA, body), "NOT_OWNER")).toBe(true); // A on B
    expect(denied(await call(method, `/api/profile/${PC}`, asA, body), "NOT_OWNER")).toBe(true); // A on C
    expect(denied(await call(method, `/api/profile/${PA}`, asC, body), "NOT_OWNER")).toBe(true); // C on A
    expect(denied(await call(method, `/api/profile/not-an-id`, asA, body), "NOT_OWNER")).toBe(true);
    expect(reached(await call(method, `/api/profile/${PB}`, asCrm, body))).toBe(true);
    expect(denied(await call(method, `/api/profile/${PB}`, asCrmNoPerm, body), "PDP_DENY")).toBe(true);
    expect(denied(await call(method, `/api/profile/${PA}`, asUnknownType, body), "CRM_ONLY")).toBe(true);
  });

  test("an inactive own profile is not 'own' (no self-reactivation path)", async () => {
    Profile.reset();
    Profile.seed([{ _id: PA, tenantId: TA, userId: LA, isActive: false }]);
    expect(denied(await call("GET", `/api/profile/${PA}`, asA), "NOT_OWNER")).toBe(true);
  });

  test("a profile that only matches by email / membership number is not 'own'", async () => {
    Profile.reset();
    Profile.seed([{ _id: PA, tenantId: TA, userId: null, isActive: true, normalizedEmail: "a@invalid.test", membershipNumber: "A001" }]);
    expect(denied(await call("GET", `/api/profile/${PA}`, asA), "NOT_OWNER")).toBe(true);
  });
});

describe("P5 profile: delete and merge are CRM-only", () => {
  test("DELETE /:profileId", async () => {
    expect(denied(await call("DELETE", `/api/profile/${PA}`, asA), "CRM_ONLY")).toBe(true); // no portal self-delete
    expect(denied(await call("DELETE", `/api/profile/${PB}`, asA), "CRM_ONLY")).toBe(true);
    expect(denied(await call("DELETE", `/api/profile/${PC}`, asA), "CRM_ONLY")).toBe(true);
    expect(reached(await call("DELETE", `/api/profile/${PB}`, asCrm))).toBe(true);
    expect(denied(await call("DELETE", `/api/profile/${PB}`, asCrmNoPerm), "PDP_DENY")).toBe(true);
  });

  test.each([
    ["POST", `/api/profile/${PB}/duplicate-merge`],
    ["POST", `/api/profile/${PA}/duplicate-merge`],
    ["POST", `/api/profile/${PB}/detect-duplicates`],
    ["GET", `/api/profile/${PB}/duplicate-matches`],
    ["GET", `/api/profile/${PB}/duplicate-merge-compare/${PA}`],
  ])("%s %s", async (method, url) => {
    const body = method === "POST" ? { targetProfileId: PA } : undefined;
    expect(denied(await call(method, url, asA, body), "CRM_ONLY")).toBe(true);
    expect(reached(await call(method, url, asCrm, body))).toBe(true);
    expect(denied(await call(method, url, asCrmNoPerm, body), "PDP_DENY")).toBe(true);
  });
});

describe("P5 profile: batch / internal lookups", () => {
  test("POST /batch: internal unchanged, CRM + permission, portal self only", async () => {
    expect(reached(await call("POST", "/api/profile/batch", internal(TA), { profileIds: [PB] }))).toBe(true);
    expect(reached(await call("POST", "/api/profile/batch", asA, { profileIds: [PA] }))).toBe(true);
    expect(denied(await call("POST", "/api/profile/batch", asA, { profileIds: [PB] }), "NOT_OWNER")).toBe(true);
    expect(denied(await call("POST", "/api/profile/batch", asA, { profileIds: [PA, PB] }), "NOT_OWNER")).toBe(true);
    expect(denied(await call("POST", "/api/profile/batch", asA, { profileIds: [PC] }), "NOT_OWNER")).toBe(true);
    expect(reached(await call("POST", "/api/profile/batch", asCrm, { profileIds: [PB] }))).toBe(true);
    expect(denied(await call("POST", "/api/profile/batch", asCrmNoPerm, { profileIds: [PB] }), "PDP_DENY")).toBe(true);
  });

  test("GET /batch?profileIds=: same rule for the query form", async () => {
    expect(reached(await call("GET", `/api/profile/batch?profileIds=${PA}`, asA))).toBe(true);
    expect(denied(await call("GET", `/api/profile/batch?profileIds=${PA},${PB}`, asA), "NOT_OWNER")).toBe(true);
  });

  test("POST /internal/by-user-ids: portal own user id only", async () => {
    expect(reached(await call("POST", "/api/profile/internal/by-user-ids", internal(TA), { userIds: [SB] }))).toBe(true);
    expect(reached(await call("POST", "/api/profile/internal/by-user-ids", asA, { userIds: [SA] }))).toBe(true);
    expect(denied(await call("POST", "/api/profile/internal/by-user-ids", asA, { userIds: [SB] }), "NOT_OWNER")).toBe(true);
    expect(denied(await call("POST", "/api/profile/internal/by-user-ids", asA, { userIds: [SC] }), "NOT_OWNER")).toBe(true);
    expect(reached(await call("POST", "/api/profile/internal/by-user-ids", asCrm, { userIds: [SB] }))).toBe(true);
    expect(denied(await call("POST", "/api/profile/internal/by-user-ids", asCrmNoPerm, { userIds: [SB] }), "PDP_DENY")).toBe(true);
  });

  test("POST /batch-lookup and /lookup-by-membership: portal self only", async () => {
    expect(reached(await call("POST", "/api/profile/batch-lookup", asA, { profileIds: [PA] }))).toBe(true);
    expect(denied(await call("POST", "/api/profile/batch-lookup", asA, { profileIds: [PB] }), "NOT_OWNER")).toBe(true);
    expect(reached(await call("POST", "/api/profile/lookup-by-membership", asA, { membershipNumbers: ["A001"] }))).toBe(true);
    expect(denied(await call("POST", "/api/profile/lookup-by-membership", asA, { membershipNumbers: ["B001"] }), "NOT_OWNER")).toBe(true);
    expect(denied(await call("POST", "/api/profile/lookup-by-membership", asA, { membershipNumbers: ["C001"] }), "NOT_OWNER")).toBe(true);
    expect(reached(await call("POST", "/api/profile/lookup-by-membership", asCrm, { membershipNumbers: ["B001"] }))).toBe(true);
    expect(denied(await call("POST", "/api/profile/lookup-by-membership", asCrmNoPerm, { membershipNumbers: ["B001"] }), "PDP_DENY")).toBe(true);
  });

  test("self-service /my-* routes are unchanged for the portal", async () => {
    expect(reached(await call("GET", "/api/profile/my-profile", asA))).toBe(true);
    expect(reached(await call("PUT", "/api/profile/my-profile", asA, {}))).toBe(true);
    expect(reached(await call("GET", "/api/profile/aggregated-user-details", asA))).toBe(true);
  });
});

describe("P5 applications: administrative decisions are CRM + application:write", () => {
  const admin = [
    ["POST", `/api/applications/${APP_B}/approve`],
    ["POST", `/api/applications/${APP_B}/reject`],
    ["POST", "/api/applications/bulk-approval"],
    ["POST", `/api/applications/${APP_B}/executive-council-approval`],
    ["POST", "/api/applications/bulk-executive-council-approval"],
    ["POST", `/api/applications/${APP_B}/review-draft`],
    ["POST", `/api/applications/${APP_B}/detect-duplicates`],
    ["POST", `/api/applications/${APP_B}/duplicate-review`],
    ["GET", `/api/applications/${APP_B}/duplicate-matches`],
    ["GET", `/api/applications/${APP_B}/duplicate-merge-compare/${PB}`],
    ["PUT", `/api/applications/status/${APP_B}`],
    ["GET", "/api/applications"],
    ["PUT", "/api/applications/filter"],
  ];
  test.each(admin)("%s %s", async (method, url) => {
    const body = method === "GET" ? undefined : {};
    expect(denied(await call(method, url, asA, body), "CRM_ONLY")).toBe(true);
    expect(denied(await call(method, url, asC, body), "CRM_ONLY")).toBe(true);
    expect(reached(await call(method, url, asCrm, body))).toBe(true);
    expect(denied(await call(method, url, asCrmNoPerm, body), "PDP_DENY")).toBe(true);
  });

  test("portal self-service application reads still reach their (owner-checked) handlers", async () => {
    expect(reached(await call("GET", "/api/applications/me", asA))).toBe(true);
    expect(reached(await call("GET", `/api/applications/${APP_B}`, asA))).toBe(true); // controller owner check
  });
});

describe("P5 payment forms", () => {
  const crmOnly = [
    ["GET", `/api/payment-forms/${FORM_B}`],
    ["GET", `/api/payment-forms/${FORM_B}/pdf`],
    ["PATCH", `/api/payment-forms/${FORM_B}`],
    ["POST", `/api/payment-forms/${FORM_B}/submit`],
    ["POST", `/api/payment-forms/${FORM_B}/verify`],
    ["POST", `/api/payment-forms/${FORM_B}/approve`],
    ["POST", `/api/payment-forms/${FORM_B}/reject`],
    ["DELETE", `/api/payment-forms/${FORM_B}`],
    ["POST", `/api/payment-forms/${FORM_B}/send-email`],
    ["PUT", "/api/payment-forms/filter"],
    ["POST", "/api/payment-forms"],
    ["GET", `/api/payment-forms/profile/${PB}`],
  ];
  test.each(crmOnly)("%s %s is CRM + payments permission", async (method, url) => {
    const body = ["GET", "DELETE"].includes(method) ? undefined : {};
    expect(denied(await call(method, url, asA, body), "CRM_ONLY")).toBe(true);
    expect(denied(await call(method, url, asC, body), "CRM_ONLY")).toBe(true);
    expect(reached(await call(method, url, asCrm, body))).toBe(true);
    expect(denied(await call(method, url, asCrmNoPerm, body), "PDP_DENY")).toBe(true);
  });

  // PDP P3 (Q2): the SEPA prepare feed additionally needs payments.bank:read (helpers/bankDataAccess.js);
  // controller-level behaviour (empty profileIds, the filter purpose) is in paymentFormBankData.p3.test.js.
  test("POST /direct-debit/mandates-for-prepare is CRM + payments permission + payments.bank:read", async () => {
    const url = "/api/payment-forms/direct-debit/mandates-for-prepare";
    const asCrmBank = { authorization: token({ sub: CRM_ID, tenantId: TA, userType: "CRM", permissions: [...CRM_PERMS, "payments.bank:read"] }) };
    expect(denied(await call("POST", url, asA, {}), "CRM_ONLY")).toBe(true);
    expect(denied(await call("POST", url, asC, {}), "CRM_ONLY")).toBe(true);
    expect(denied(await call("POST", url, asCrmNoPerm, {}), "PDP_DENY")).toBe(true);
    expect(denied(await call("POST", url, asCrm, {}), "BANK_DATA_PERMISSION_REQUIRED")).toBe(true);
    expect(reached(await call("POST", url, asCrmBank, {}))).toBe(true);
  });

  // PDP P3: payments.bank:read is a READ grant only - it never substitutes for payments:write on a CRM mutation,
  // and a payments:write caller without it still reaches the write routes (responses masked in the service).
  test("payments.bank:read never authorises a payment-form mutation; payments:write alone still does (masked)", async () => {
    const asBankReadOnly = { authorization: token({ sub: CRM_ID, tenantId: TA, userType: "CRM", permissions: ["payments:read", "payments.bank:read"] }) };
    const asWriteOnly = { authorization: token({ sub: CRM_ID, tenantId: TA, userType: "CRM", permissions: ["payments:write"] }) };
    const mutations = [
      ["PATCH", `/api/payment-forms/${FORM_B}`],
      ["POST", `/api/payment-forms/${FORM_B}/submit`],
      ["POST", `/api/payment-forms/${FORM_B}/verify`],
      ["POST", `/api/payment-forms/${FORM_B}/approve`],
      ["POST", `/api/payment-forms/${FORM_B}/reject`],
      ["DELETE", `/api/payment-forms/${FORM_B}`],
      ["POST", `/api/payment-forms/${FORM_B}/send-email`],
      ["POST", "/api/payment-forms"],
    ];
    for (const [method, url] of mutations) {
      const body = method === "DELETE" ? undefined : {};
      expect([method, url, denied(await call(method, url, asBankReadOnly, body), "PDP_DENY")]).toEqual([method, url, true]);
      expect([method, url, reached(await call(method, url, asWriteOnly, body))]).toEqual([method, url, true]);
    }
    // the SEPA feed is a bank READ: payments:write without payments:read / payments.bank:read is refused
    expect(denied(await call("POST", "/api/payment-forms/direct-debit/mandates-for-prepare", asWriteOnly, {}), "PDP_DENY")).toBe(true);
    // unknown caller type: refused before any permission check
    expect(denied(await call("POST", "/api/payment-forms/direct-debit/mandates-for-prepare", asUnknownType, {}), "CRM_ONLY")).toBe(true);
    expect(denied(await call("GET", `/api/payment-forms/${FORM_B}`, asUnknownType), "CRM_ONLY")).toBe(true);
  });

  test("GET /prefill?profileId: portal own profile only", async () => {
    expect(reached(await call("GET", `/api/payment-forms/prefill?profileId=${PA}`, asA))).toBe(true);
    expect(denied(await call("GET", `/api/payment-forms/prefill?profileId=${PB}`, asA), "NOT_OWNER")).toBe(true);
    expect(denied(await call("GET", `/api/payment-forms/prefill?profileId=${PC}`, asA), "NOT_OWNER")).toBe(true);
    expect(denied(await call("GET", "/api/payment-forms/prefill", asA), "NOT_OWNER")).toBe(true);
    expect(reached(await call("GET", `/api/payment-forms/prefill?profileId=${PB}`, asCrm))).toBe(true);
  });

  test("/portal router is PORTAL callers only (ownership then enforced by the service)", async () => {
    expect(reached(await call("GET", "/api/payment-forms/portal/mine", asA))).toBe(true);
    expect(reached(await call("GET", `/api/payment-forms/portal/${FORM_B}`, asA))).toBe(true);
    expect(denied(await call("GET", "/api/payment-forms/portal/mine", asCrm), "PORTAL_ONLY")).toBe(true);
    expect(denied(await call("GET", `/api/payment-forms/portal/${FORM_B}`, asCrm), "PORTAL_ONLY")).toBe(true);
  });
});

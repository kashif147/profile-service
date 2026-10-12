// Phase 2C Track B: POST /api/profile/validate (Azure B2C sign-up connector) only ever looks
// up profiles in the TRUSTED tenant (internal call: x-internal-request + x-tenant-id set by
// user-service from the authenticated connector). A tenantId in the body is ignored and never
// echoed; no trusted tenant -> fail closed (ShowBlockPage) and no query runs.
process.env.JWT_SECRET = process.env.JWT_SECRET || "unit-test-secret-profile-validation";
const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const mockProfiles = [
  { _id: "pB1", tenantId: B, normalizedEmail: "shared@example.test", membershipNumber: "B00001", isActive: true, contactInfo: { mobileNumber: "+353870000001" } },
  { _id: "pA1", tenantId: A, normalizedEmail: "alice@example.test", membershipNumber: "B00001", isActive: true, contactInfo: {} },
];
const mockQueries = [];
jest.mock("../models/profile.model", () => ({
  find: jest.fn((q) => {
    mockQueries.push(q);
    const match = (p) =>
      (q.tenantId === undefined || p.tenantId === q.tenantId) &&
      (q.$or || []).some((c) =>
        Object.entries(c).every(([k, v]) => (k === "contactInfo.mobileNumber" ? p.contactInfo?.mobileNumber === v : p[k] === v)));
    const rows = mockProfiles.filter(match);
    const chain = { maxTimeMS: () => chain, lean: () => chain, exec: async () => rows };
    return chain;
  }),
}));
const jwt = require("jsonwebtoken");
const { validateProfile } = require("../controllers/profile.validation.controller");

function call(body, headers = {}) {
  return new Promise((resolve) => {
    const res = {
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.code = code; return this; },
      json(payload) { resolve({ code: this.code, body: payload }); return this; },
    };
    validateProfile({ body, headers, query: {}, method: "POST", originalUrl: "/api/profile/validate" }, res);
  });
}
const internal = (tenant) => ({ "x-internal-request": "true", "x-tenant-id": tenant });
beforeEach(() => { mockQueries.length = 0; });

test("1 no trusted tenant (direct caller, body tenantId only) fails closed and runs no query", async () => {
  const r = await call({ email: "shared@example.test", tenantId: B, step: "PostAttributeCollection" });
  expect(r.body.action).toBe("ShowBlockPage");
  expect(mockQueries).toHaveLength(0);
});

test("2 a user identity without the internal flag cannot use the connector endpoint", async () => {
  const token = jwt.sign({ sub: "u1", id: "u1", tenantId: B, userType: "PORTAL" }, process.env.JWT_SECRET);
  const r = await call({ email: "shared@example.test" }, { authorization: `Bearer ${token}`, "x-tenant-id": B });
  expect(r.body.action).toBe("ShowBlockPage");
  expect(mockQueries).toHaveLength(0);
});

test("3 tenant A cannot discover tenant B's profile by email", async () => {
  const r = await call({ email: "shared@example.test", step: "PostAttributeCollection" }, internal(A));
  expect(r.body.action).toBe("Continue");
  expect(r.body.profileId).toBeUndefined();
  expect(r.body.tenantId).toBe(A);
  expect(mockQueries[0].tenantId).toBe(A);
});

test("4 tenant A cannot discover tenant B's member by membership number (B00001 exists in both)", async () => {
  const r = await call({ email: "new@example.test", membershipNumber: "B00001", step: "PostAttributeCollection" }, internal(A));
  // A's own B00001 (alice) matches, never B's.
  expect(r.body.profileId).toBe("pA1");
  expect(mockQueries.every((q) => q.tenantId === A)).toBe(true);
});

test("5 the trusted tenant still finds its own existing profile", async () => {
  const r = await call({ email: "shared@example.test", step: "PostAttributeCollection" }, internal(B));
  expect(r.body.action).toBe("Continue");
  expect(r.body.profileId).toBe("pB1");
  expect(r.body.tenantId).toBe(B);
});

test("6 a body tenantId that disagrees with the trusted tenant is rejected (logged mismatch), never used", async () => {
  const r = await call({ email: "shared@example.test", tenantId: B, step: "PostAttributeCollection" }, internal(A));
  expect(r.body.action).toBe("ShowBlockPage");
  expect(r.body.profileId).toBeUndefined();
  expect(mockQueries).toHaveLength(0);
});

test("7 a body tenantId equal to the trusted tenant is accepted and the lookup stays scoped", async () => {
  const r = await call({ email: "shared@example.test", tenantId: B, step: "PostAttributeCollection" }, internal(B));
  expect(r.body.profileId).toBe("pB1");
  expect(mockQueries.every((q) => q.tenantId === B)).toBe(true);
});

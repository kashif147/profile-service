// Generic personal/professional/subscription details handlers must fail closed without a
// trusted tenant and scope every query to the caller's tenant (Tenant A/B).
const mockCalls = [];

function mockChain(result) {
  const p = Promise.resolve(result);
  const c = {
    sort: () => c, lean: () => c, select: () => c, limit: () => c, skip: () => c, populate: () => c,
    exec: () => p, then: (a, b) => p.then(a, b), catch: (b) => p.catch(b),
  };
  return c;
}

function mockFakeModel(name) {
  const record = (method) => (filter) => {
    mockCalls.push({ model: name, method, filter });
    return mockChain(method === "find" ? [] : null);
  };
  const m = {};
  for (const method of ["find", "findOne", "findOneAndUpdate", "findOneAndDelete", "updateOne", "updateMany", "deleteOne", "countDocuments"]) {
    m[method] = jest.fn(record(method));
  }
  m.create = jest.fn(async (d) => ({ ...d, _id: "new" }));
  m.collection = { updateOne: jest.fn(record("collection.updateOne")) };
  return m;
}

jest.mock("../models/personal.details.model", () => mockFakeModel("PersonalDetails"));
jest.mock("../models/professional.details.model", () => mockFakeModel("ProfessionalDetails"));
jest.mock("../models/subscription.model", () => mockFakeModel("SubscriptionDetails"));
jest.mock("../services/duplicate.detection.service.js", () => ({ queueDuplicateDetection: jest.fn() }));

const handlers = {
  personal: require("../handlers/personal.details.handler"),
  professional: require("../handlers/professional.details.handler"),
  subscription: require("../handlers/subscription.details.handler"),
};

const TENANT_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const SKIP = new Set(["findSubscriptionRecord"]);

function argsFor(fn, tenantId) {
  // tenantId is the last parameter of every scoped handler.
  const n = Math.max(fn.length - 1, 0);
  const args = Array.from({ length: n }, (_, i) => (i === n - 1 && n > 1 ? {} : "507f1f77bcf86cd799439011"));
  return [...args, tenantId];
}

const cases = [];
for (const [group, mod] of Object.entries(handlers)) {
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn !== "function" || SKIP.has(name) || name === "create") continue;
    cases.push([`${group}.${name}`, fn]);
  }
}

beforeEach(() => {
  mockCalls.length = 0;
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("every scoped handler is covered", () => {
  expect(cases.length).toBeGreaterThanOrEqual(40);
});

test.each(cases)("%s rejects without a trusted tenant and runs no query", async (_n, fn) => {
  for (const missing of [undefined, null, ""]) {
    await expect(fn(...argsFor(fn, missing))).rejects.toMatchObject({ status: 401 });
  }
  expect(mockCalls).toEqual([]);
});

test.each(cases)("%s scopes every query to the caller's tenant (B)", async (_n, fn) => {
  await fn(...argsFor(fn, TENANT_B)).catch(() => {});
  expect(mockCalls.length).toBeGreaterThan(0);
  for (const c of mockCalls) {
    expect(c.filter && c.filter.tenantId).toBe(TENANT_B);
  }
});

test.each(Object.entries(handlers))("%s.create requires a tenant on the document", async (_g, mod) => {
  await expect(mod.create({ applicationId: "a" })).rejects.toMatchObject({ status: 401 });
  await expect(mod.create({ applicationId: "a", tenantId: TENANT_B })).resolves.toMatchObject({ tenantId: TENANT_B });
});

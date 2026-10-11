// Per-tenant membership numbering (Phase 2B-PARALLEL-2, B5): Tenant A/B sequences are
// independent, existing numbers are preserved (counter seeded from the tenant's max), and
// no number is issued without a tenant.
const mockProfiles = [];
const mockSeqs = new Map(); // `${tenantId}|${letter}` -> seq

jest.mock("../models/profile.model", () => ({
  findOne: jest.fn((q) => {
    const re = new RegExp(q.membershipNumber.$regex);
    const rows = mockProfiles
      .filter((p) => p.tenantId === q.tenantId && re.test(p.membershipNumber))
      .sort((a, b) => (a.membershipNumber < b.membershipNumber ? 1 : -1));
    const chain = { sort: () => chain, select: () => chain, lean: async () => rows[0] || null };
    return chain;
  }),
}));

jest.mock("../models/membershipNumberSequence.model", () => {
  const key = (f) => `${f.tenantId}|${f.yearAlphabet}`;
  return {
    exists: jest.fn(async (f) => mockSeqs.has(key(f))),
    updateOne: jest.fn(async (f, u, opts = {}) => {
      const k = key(f);
      if (!mockSeqs.has(k)) {
        if (!opts.upsert) return { matchedCount: 0 };
        mockSeqs.set(k, 0);
      }
      if (u.$max) mockSeqs.set(k, Math.max(mockSeqs.get(k), u.$max.seq));
      return { matchedCount: 1 };
    }),
    findOneAndUpdate: jest.fn((f, u) => ({
      lean: async () => {
        const k = key(f);
        mockSeqs.set(k, (mockSeqs.get(k) || 0) + u.$inc.seq);
        return { tenantId: f.tenantId, yearAlphabet: f.yearAlphabet, seq: mockSeqs.get(k) };
      },
    })),
  };
});

const { generateMembershipNumber, getCurrentYearAlphabet } = require("../helpers/membership.number.generator");

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";

beforeEach(() => {
  mockProfiles.length = 0;
  mockSeqs.clear();
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("tenants A and B have independent sequences", async () => {
  const L = getCurrentYearAlphabet();
  expect(await generateMembershipNumber(A)).toBe(`${L}00001`);
  expect(await generateMembershipNumber(A)).toBe(`${L}00002`);
  expect(await generateMembershipNumber(B)).toBe(`${L}00001`);
  expect(await generateMembershipNumber(A)).toBe(`${L}00003`);
});

test("counter is seeded from the tenant's own highest existing number (no renumbering)", async () => {
  const L = getCurrentYearAlphabet();
  mockProfiles.push(
    { tenantId: A, membershipNumber: `${L}00041` },
    { tenantId: A, membershipNumber: `${L}00007` },
    { tenantId: B, membershipNumber: `${L}00900` },
  );
  expect(await generateMembershipNumber(A)).toBe(`${L}00042`);
  expect(await generateMembershipNumber(B)).toBe(`${L}00901`);
  // Existing rows are untouched.
  expect(mockProfiles.map((p) => p.membershipNumber)).toEqual([`${L}00041`, `${L}00007`, `${L}00900`]);
});

test("tenant B's numbers never influence tenant A's sequence", async () => {
  const L = getCurrentYearAlphabet();
  mockProfiles.push({ tenantId: B, membershipNumber: `${L}05000` });
  expect(await generateMembershipNumber(A)).toBe(`${L}00001`);
});

test("no tenant -> 401, no number issued", async () => {
  for (const t of [undefined, null, ""]) {
    await expect(generateMembershipNumber(t)).rejects.toMatchObject({ status: 401 });
  }
  expect(mockSeqs.size).toBe(0);
});

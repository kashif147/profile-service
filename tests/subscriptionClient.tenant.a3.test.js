// Phase A / A3 — profile-service never calls subscription-service without the caller's trusted tenant
// and never retries with an empty tenant (that unscoped retry leaked other tenants' subscriptions).
jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));
const axios = require("axios");
const { fetchCurrentSubscriptionByProfileId } = require("../services/subscription.service.client.js");

const A = "68cbf7806080b4621d469d34";
const PROFILE = "6a4444444444444444444444";

beforeEach(() => jest.clearAllMocks());
afterAll(() => jest.restoreAllMocks());

test("tenant-scoped call carries the trusted tenant", async () => {
  axios.get.mockResolvedValue({ status: 200, data: { data: [{ _id: "s1", isCurrent: true, tenantId: A }] } });
  const sub = await fetchCurrentSubscriptionByProfileId(PROFILE, A);
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(axios.get.mock.calls[0][1].headers["x-tenant-id"]).toBe(A);
  expect(axios.get.mock.calls[0][1].headers["x-internal-request"]).toBe("true");
  expect(sub && sub._id).toBe("s1");
});

test("no subscriptions in the tenant -> null, and NO empty-tenant retry", async () => {
  axios.get.mockResolvedValue({ status: 200, data: { data: [] } });
  const sub = await fetchCurrentSubscriptionByProfileId(PROFILE, A);
  expect(sub).toBeNull();
  expect(axios.get).toHaveBeenCalledTimes(1);
  for (const call of axios.get.mock.calls) expect(call[1].headers["x-tenant-id"]).toBe(A);
});

test("4xx from subscription-service -> null, no retry", async () => {
  axios.get.mockResolvedValue({ status: 400, data: { code: "TENANT_REQUIRED" } });
  expect(await fetchCurrentSubscriptionByProfileId(PROFILE, A)).toBeNull();
  expect(axios.get).toHaveBeenCalledTimes(1);
});

test("no trusted tenant -> no call at all", async () => {
  for (const t of [undefined, null, "", "   "]) {
    expect(await fetchCurrentSubscriptionByProfileId(PROFILE, t)).toBeNull();
  }
  expect(axios.get).not.toHaveBeenCalled();
});

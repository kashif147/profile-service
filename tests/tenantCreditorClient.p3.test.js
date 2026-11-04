"use strict";
/**
 * PDP rollout P3 (O6 / finding N3): payment-form hydration reads the organisation's creditor details from
 * user-service's internal-only GET /internal/tenants/:id/creditor-profile as a service call (secret, no user
 * token), and fails closed (503) instead of persisting a blank creditor snapshot.
 */
jest.mock("axios", () => ({ get: jest.fn() }));
const axios = require("axios");
const { fetchCreditorContext } = require("../services/tenant.service.client.js");

const TA = "aaaaaaaaaaaaaaaaaaaaaaaa";
const SECRET = "p3-creditor-profile-test-secret-0123456789";
const req = { headers: { authorization: "Bearer user-token", "x-user-id": "u1" } };

beforeEach(() => {
  axios.get.mockReset();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.INTERNAL_TENANT_PROFILE_SECRET;
  jest.restoreAllMocks();
});

test("configured: internal endpoint, service secret + tenant, NO user token forwarded; creditor fields returned", async () => {
  process.env.INTERNAL_TENANT_PROFILE_SECRET = SECRET;
  axios.get.mockResolvedValue({
    status: 200,
    data: { data: { name: "Org A", code: "ORGA", branding: { primaryColor: "#000" }, organisationProfile: { iban: "IE29AIBK93115212345678", bic: "AIBKIE2DXXX" } } },
  });
  const ctx = await fetchCreditorContext(TA, req);
  expect(ctx).toEqual({ branding: { primaryColor: "#000" }, organisationProfile: { iban: "IE29AIBK93115212345678", bic: "AIBKIE2DXXX" }, tenantName: "Org A" });
  const [url, opts] = axios.get.mock.calls[0];
  expect(url).toMatch(new RegExp(`/internal/tenants/${TA}/creditor-profile$`));
  expect(url).not.toMatch(/\/api\//);
  expect(opts.headers["x-service-secret"]).toBe(SECRET);
  expect(opts.headers["x-tenant-id"]).toBe(TA);
  expect(opts.headers.authorization).toBeUndefined();
  expect(opts.headers["x-user-id"]).toBeUndefined();
});

test("configured: non-200 or a network error -> 503 CREDITOR_PROFILE_UNAVAILABLE (never a blank snapshot)", async () => {
  process.env.INTERNAL_TENANT_PROFILE_SECRET = SECRET;
  for (const status of [403, 404, 500]) {
    axios.get.mockResolvedValueOnce({ status, data: {} });
    await expect(fetchCreditorContext(TA, req)).rejects.toMatchObject({ status: 503, code: "CREDITOR_PROFILE_UNAVAILABLE" });
  }
  axios.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));
  await expect(fetchCreditorContext(TA, req)).rejects.toMatchObject({ status: 503 });
  await expect(fetchCreditorContext(null, req)).rejects.toMatchObject({ status: 503 });
});

test("not configured (rollout): the previous forwarded-token tenant fetch is used unchanged", async () => {
  axios.get.mockResolvedValue({ status: 200, data: { data: { name: "Org A", organisationProfile: { legalName: "Org A Ltd" }, branding: {} } } });
  const ctx = await fetchCreditorContext(TA, req);
  expect(ctx.organisationProfile).toEqual({ legalName: "Org A Ltd" });
  const [url, opts] = axios.get.mock.calls[0];
  expect(url).toMatch(new RegExp(`/api/tenants/${TA}$`));
  expect(opts.headers.authorization).toBe("Bearer user-token");
});

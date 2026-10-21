"use strict";
jest.mock("axios", () => ({ get: jest.fn() }));
const axios = require("axios");
const tz = require("../services/tenantTimezone.service");

const ok = (timezone) => ({ status: 200, data: { status: "success", data: { regionalSettings: { timezone } } } });

beforeEach(() => {
  tz.clearCache();
  axios.get.mockReset();
});

test("uses the tenant's configured timezone via the internal lifecycle-config endpoint", async () => {
  axios.get.mockResolvedValue(ok("America/New_York"));
  expect(await tz.getTenantTimezone("t1")).toBe("America/New_York");
  const [url, options] = axios.get.mock.calls[0];
  expect(url).toMatch(/\/api\/internal\/tenants\/t1\/lifecycle-config$/);
  expect(options.headers).toEqual({ "x-internal-request": "true", "x-tenant-id": "t1" });
});

test.each([
  ["an invalid timezone", () => axios.get.mockResolvedValue(ok("Mars/Olympus"))],
  ["no timezone", () => axios.get.mockResolvedValue({ status: 200, data: { data: {} } })],
  ["a 404", () => axios.get.mockResolvedValue({ status: 404, data: {} })],
  ["a network error", () => axios.get.mockRejectedValue(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))],
])("falls back to Europe/Dublin on %s", async (_label, arrange) => {
  arrange();
  expect(await tz.getTenantTimezone("t1")).toBe("Europe/Dublin");
});

test("no tenant -> fallback without a call", async () => {
  expect(await tz.getTenantTimezone(null)).toBe("Europe/Dublin");
  expect(axios.get).not.toHaveBeenCalled();
});

test("caches per tenant; fallbacks from failures expire sooner", async () => {
  axios.get.mockResolvedValue(ok("Europe/London"));
  await tz.getTenantTimezone("t1", { now: 0 });
  await tz.getTenantTimezone("t1", { now: 9 * 60 * 1000 });
  expect(axios.get).toHaveBeenCalledTimes(1);
  await tz.getTenantTimezone("t2", { now: 0 });
  expect(axios.get).toHaveBeenCalledTimes(2);

  axios.get.mockRejectedValue(new Error("down"));
  await tz.getTenantTimezone("t3", { now: 0 });
  await tz.getTenantTimezone("t3", { now: 2 * 60 * 1000 });
  expect(axios.get).toHaveBeenCalledTimes(4);
});

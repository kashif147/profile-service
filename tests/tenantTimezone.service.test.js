"use strict";
jest.mock("axios", () => ({ get: jest.fn() }));
const axios = require("axios");
const tz = require("../services/tenantTimezone.service");

const ok = (timezone, tenantId = "t1") => ({
  status: 200,
  data: { status: "success", data: { tenantId, timezone, locale: "en-IE" } },
});
const callerReq = (extra = {}) => ({
  headers: {
    authorization: "Bearer caller-jwt",
    "x-user-id": "u1",
    "x-correlation-id": "c1",
    "x-internal-request": "true", // must NOT be forwarded
    "x-user-roles": '["SU"]', // must NOT be forwarded
    ...extra,
  },
});

beforeEach(() => {
  tz.clearCache();
  axios.get.mockReset();
});

test("reads the caller's own tenant settings with the caller's credentials, no internal bypass", async () => {
  axios.get.mockResolvedValue(ok("America/New_York"));
  expect(await tz.getTenantTimezone("t1", callerReq())).toBe("America/New_York");
  const [url, options] = axios.get.mock.calls[0];
  expect(url).toMatch(/\/api\/tenant\/regional-settings$/);
  expect(url).not.toContain("t1");
  expect(options.headers).toEqual({
    authorization: "Bearer caller-jwt",
    "x-user-id": "u1",
    "x-correlation-id": "c1",
    "x-tenant-id": "t1",
  });
});

test("no caller credentials -> fallback without a call", async () => {
  expect(await tz.getTenantTimezone("t1", { headers: {} })).toBe("Europe/Dublin");
  expect(await tz.getTenantTimezone(null, callerReq())).toBe("Europe/Dublin");
  expect(axios.get).not.toHaveBeenCalled();
});

test("ignores an answer about a different tenant", async () => {
  axios.get.mockResolvedValue(ok("Asia/Tokyo", "someone-else"));
  expect(await tz.getTenantTimezone("t1", callerReq())).toBe("Europe/Dublin");
});

test.each([
  ["an invalid timezone", () => axios.get.mockResolvedValue(ok("Mars/Olympus"))],
  ["no timezone", () => axios.get.mockResolvedValue({ status: 200, data: { data: {} } })],
  ["403 (caller lacks the permission)", () => axios.get.mockResolvedValue({ status: 403, data: {} })],
  ["404 (endpoint not deployed yet)", () => axios.get.mockResolvedValue({ status: 404, data: {} })],
  ["a network error", () => axios.get.mockRejectedValue(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))],
])("falls back to Europe/Dublin on %s", async (_label, arrange) => {
  arrange();
  expect(await tz.getTenantTimezone("t1", callerReq())).toBe("Europe/Dublin");
});

test("caches successes per tenant for 10 minutes", async () => {
  axios.get.mockResolvedValue(ok("Europe/London"));
  await tz.getTenantTimezone("t1", callerReq(), { now: 0 });
  await tz.getTenantTimezone("t1", callerReq(), { now: 9 * 60 * 1000 });
  expect(axios.get).toHaveBeenCalledTimes(1);
  await tz.getTenantTimezone("t1", callerReq(), { now: 11 * 60 * 1000 });
  expect(axios.get).toHaveBeenCalledTimes(2);
});

test("403 is never cached: the next caller with permission gets the real value", async () => {
  axios.get.mockResolvedValueOnce({ status: 403, data: {} }).mockResolvedValueOnce(ok("Europe/London"));
  expect(await tz.getTenantTimezone("t1", callerReq(), { now: 0 })).toBe("Europe/Dublin");
  expect(await tz.getTenantTimezone("t1", callerReq(), { now: 1 })).toBe("Europe/London");
});

test("404 / outage is cached for a minute only", async () => {
  axios.get.mockResolvedValue({ status: 404, data: {} });
  await tz.getTenantTimezone("t1", callerReq(), { now: 0 });
  await tz.getTenantTimezone("t1", callerReq(), { now: 30 * 1000 });
  expect(axios.get).toHaveBeenCalledTimes(1);
  await tz.getTenantTimezone("t1", callerReq(), { now: 61 * 1000 });
  expect(axios.get).toHaveBeenCalledTimes(2);
});

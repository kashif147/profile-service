// P5 - profile-service's subscription-service client has no hard-coded fallback host. A missing or
// empty SUBSCRIPTION_SERVICE_URL fails closed (503 SUBSCRIPTION_SERVICE_URL_REQUIRED) before any
// request, so the internal header and trusted tenant are never sent to a public address.
jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));
const axios = require("axios");
const client = require("../services/subscription.service.client.js");

const T = "68cbf7806080b4621d469d34";
const P = "6a4444444444444444444444";
const ORIGINAL = process.env.SUBSCRIPTION_SERVICE_URL;

afterEach(() => {
  jest.clearAllMocks();
  if (ORIGINAL === undefined) delete process.env.SUBSCRIPTION_SERVICE_URL;
  else process.env.SUBSCRIPTION_SERVICE_URL = ORIGINAL;
});

function allUrls() {
  return [...axios.get.mock.calls, ...axios.post.mock.calls].map((c) => String(c[0]));
}

describe.each([
  ["unset", undefined],
  ["empty", ""],
  ["whitespace", "   "],
])("SUBSCRIPTION_SERVICE_URL %s", (_label, value) => {
  beforeEach(() => {
    if (value === undefined) delete process.env.SUBSCRIPTION_SERVICE_URL;
    else process.env.SUBSCRIPTION_SERVICE_URL = value;
  });

  test("current-subscription lookup throws 503 SUBSCRIPTION_SERVICE_URL_REQUIRED and makes no request", async () => {
    await expect(client.fetchCurrentSubscriptionByProfileId(P, T)).rejects.toMatchObject({
      status: 503,
      code: "SUBSCRIPTION_SERVICE_URL_REQUIRED",
    });
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test("profile-merge reassignment throws 503 SUBSCRIPTION_SERVICE_URL_REQUIRED and makes no request", async () => {
    await expect(
      client.reassignSubscriptionsForProfileMerge({ tenantId: T, masterProfileId: P, absorbedProfileId: "6a5555555555555555555555" }),
    ).rejects.toMatchObject({ status: 503, code: "SUBSCRIPTION_SERVICE_URL_REQUIRED" });
    expect(allUrls()).toEqual([]);
  });

  test("the module source carries no hard-coded external host", () => {
    const src = require("fs").readFileSync(require.resolve("../services/subscription.service.client.js"), "utf8");
    expect(src).not.toMatch(/cloudapp\.azure\.com|azurewebsites\.net|https?:\/\/[a-z0-9.-]+\.(com|net|io)\b/i);
  });
});

describe("SUBSCRIPTION_SERVICE_URL configured", () => {
  beforeEach(() => {
    process.env.SUBSCRIPTION_SERVICE_URL = "http://subscription-service:4003/";
  });

  test("lookup goes to the configured host with internal-only headers", async () => {
    axios.get.mockResolvedValue({ status: 200, data: { data: [] } });
    await client.fetchCurrentSubscriptionByProfileId(P, T);
    expect(axios.get).toHaveBeenCalledTimes(1);
    const [url, opts] = axios.get.mock.calls[0];
    expect(url).toBe(`http://subscription-service:4003/api/v1/subscriptions/profile/${P}`);
    expect(opts.headers).toEqual(client.buildHeaders(T));
    expect(opts.headers["x-internal-request"]).toBe("true");
    expect(opts.headers["x-tenant-id"]).toBe(T);
    expect(Object.keys(opts.headers).some((h) => /^(authorization|x-user-|x-jwt-|x-auth-source)/i.test(h))).toBe(false);
  });

  test("merge goes to the configured host with internal-only headers", async () => {
    axios.post.mockResolvedValue({ status: 200, data: { data: { moved: 0 } } });
    await client.reassignSubscriptionsForProfileMerge({ tenantId: T, masterProfileId: P, absorbedProfileId: "6a5555555555555555555555" });
    const [url, , opts] = axios.post.mock.calls[0];
    expect(url).toBe("http://subscription-service:4003/api/v1/subscriptions/internal/profile-merge");
    expect(opts.headers).toEqual(client.buildHeaders(T));
  });
});

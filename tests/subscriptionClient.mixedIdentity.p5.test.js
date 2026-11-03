// P5 (subscription #30 prerequisite) - profile-service's subscription-service client makes genuine
// internal calls only: x-internal-request + the trusted tenant, and NEVER the caller's identity
// (Authorization / gateway headers / x-user-*), whatever request object the caller passes in.
jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock("../models/profile.model.js", () => ({ findOne: jest.fn() }));
jest.mock("../services/personal.details.service.js", () => ({}));
jest.mock("../services/professional.details.service.js", () => ({}));
jest.mock("../services/subscription.details.service.js", () => ({}));
jest.mock("../handlers/personal.details.handler.js", () => ({}));
jest.mock("../handlers/professional.details.handler.js", () => ({}));
jest.mock("../handlers/subscription.details.handler.js", () => ({}));
const axios = require("axios");
const Profile = require("../models/profile.model.js");
const {
  buildHeaders,
  fetchCurrentSubscriptionByProfileId,
  reassignSubscriptionsForProfileMerge,
} = require("../services/subscription.service.client.js");
const { enrichWithSubscriptionService } = require("../services/aggregated.user.details.service.js");

const A = "68cbf7806080b4621d469d34";
const B = "68cbf7806080b4621d469d99";
const PROFILE = "6a4444444444444444444444";
const ABSORBED = "6a5555555555555555555555";
const IDENTITY_HEADERS = [
  "authorization",
  "x-jwt-verified",
  "x-auth-source",
  "x-gateway-signature",
  "x-token-expires-at",
  "x-user-id",
  "x-user-email",
  "x-user-type",
  "x-user-roles",
  "x-user-permissions",
];

const userReq = {
  tenantId: A,
  headers: {
    authorization: "Bearer caller-token",
    "x-jwt-verified": "true",
    "x-auth-source": "gateway",
    "x-user-id": "u-1",
    "x-user-email": "member@example.test",
    "x-user-type": "PORTAL",
    "x-user-permissions": "[\"profile:read\"]",
  },
};

function assertInternalOnly(headers, tenantId) {
  expect(headers["x-internal-request"]).toBe("true");
  expect(headers["x-tenant-id"]).toBe(tenantId);
  const sent = Object.keys(headers).map((k) => k.toLowerCase());
  for (const name of IDENTITY_HEADERS) expect(sent).not.toContain(name);
}

beforeEach(() => jest.clearAllMocks());

test("buildHeaders: internal + tenant only", () => {
  assertInternalOnly(buildHeaders(A), A);
});

test("fetchCurrentSubscriptionByProfileId never forwards the caller's identity", async () => {
  axios.get.mockResolvedValue({ status: 200, data: { data: [{ _id: "s1", isCurrent: true }] } });
  const sub = await fetchCurrentSubscriptionByProfileId(PROFILE, A, userReq);
  expect(sub._id).toBe("s1");
  expect(axios.get).toHaveBeenCalledTimes(1);
  assertInternalOnly(axios.get.mock.calls[0][1].headers, A);
});

test("reassignSubscriptionsForProfileMerge (internal-only route) never forwards the caller's identity", async () => {
  axios.post.mockResolvedValue({ status: 200, data: { data: { moved: 1 } } });
  const out = await reassignSubscriptionsForProfileMerge({
    tenantId: A,
    masterProfileId: PROFILE,
    absorbedProfileId: ABSORBED,
    req: { ...userReq, headers: { ...userReq.headers, "x-user-type": "CRM" } },
  });
  expect(out).toEqual({ moved: 1 });
  const [url, body, opts] = axios.post.mock.calls[0];
  expect(url).toMatch(/\/api\/v1\/subscriptions\/internal\/profile-merge$/);
  expect(body).toEqual(expect.objectContaining({ masterProfileId: PROFILE, absorbedProfileId: ABSORBED }));
  assertInternalOnly(opts.headers, A);
});

test("reassignSubscriptionsForProfileMerge without a trusted tenant throws and sends nothing", async () => {
  for (const tenantId of [undefined, null, "", "  "]) {
    await expect(
      reassignSubscriptionsForProfileMerge({ tenantId, masterProfileId: PROFILE, absorbedProfileId: ABSORBED, req: userReq }),
    ).rejects.toThrow(/trusted tenant/);
  }
  expect(axios.post).not.toHaveBeenCalled();
});

test("reassignSubscriptionsForProfileMerge still surfaces a 4xx refusal", async () => {
  axios.post.mockResolvedValue({ status: 403, data: { code: "INTERNAL_ONLY", message: "nope" } });
  await expect(
    reassignSubscriptionsForProfileMerge({ tenantId: A, masterProfileId: PROFILE, absorbedProfileId: ABSORBED }),
  ).rejects.toThrow("nope");
});

test("aggregated details: the internal lookup is scoped by the caller's verified tenant, not a stored one", async () => {
  Profile.findOne.mockReturnValue({
    select: () => ({ lean: async () => ({ _id: PROFILE, currentSubscriptionId: "s1" }) }),
  });
  axios.get.mockResolvedValue({ status: 200, data: { data: [{ _id: "s1", isCurrent: true }] } });
  const result = { personalDetails: { tenantId: B }, subscriptionDetails: {} };
  await enrichWithSubscriptionService(result, { ...userReq, userId: "6a6666666666666666666666", user: { id: "6a6666666666666666666666" } });
  expect(axios.get).toHaveBeenCalledTimes(1);
  assertInternalOnly(axios.get.mock.calls[0][1].headers, A);
});

"use strict";
/**
 * PDP rollout P3 (O6 / finding N3): payment-form hydration reads the organisation's creditor details from
 * user-service's internal-only GET /internal/tenants/:id/creditor-profile as a SIGNED service read (p5-svc-sig/1,
 * caller profile-service, audience user-service): no user token, no other identity header; fails closed (503)
 * instead of persisting a blank creditor snapshot. Shared vectors pinned by SHA-256 (byte-identical in user-service).
 */
jest.mock("axios", () => ({ get: jest.fn() }));
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { fetchCreditorContext } = require("../services/tenant.service.client.js");
const { signedGetHeaders, userSigningConfig } = require("../services/userServiceSigning.js");
const { canonicalString, signCanonical, sha256Hex } = require("../services/accountCommandSigning.js");

const CONTRACT = path.join(__dirname, "..", "contracts", "p5-service-signing.tenant-creditor-profile.v1.json");
const CONTRACT_SHA256 = "96cd8d33f87e261639e55ea0104e0323470c6f453f445b59fc475cf247e0991d";
const V1 = path.join(__dirname, "..", "contracts", "p5-service-signing.v1.json");
const V1_SHA256 = "470d151d232a1acc00ae724afe05bc0986a0f5131fbc55861c3edd168383bf64";
const contract = JSON.parse(fs.readFileSync(CONTRACT, "utf8"));

const TA = "aaaaaaaaaaaaaaaaaaaaaaaa";
const KID = "pr-2026-11";
const SECRET = "TEST-ONLY-p5-svc-sig-vector-secret-profile-user-0001";
const ENV = { USER_SIGNING_KID: KID, USER_SIGNING_SECRET: SECRET };
const req = { headers: { authorization: "Bearer user-token", "x-user-id": "u1", "x-jwt-verified": "true" } };
const IDENTITY = /^(authorization|x-jwt-verified|x-auth-source|x-token-expires-at|x-service-secret|x-user-|x-gateway-|x-platform-|x-ms-token-)/i;

beforeEach(() => {
  axios.get.mockReset();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("shared contract", () => {
  test("contract files are pinned (byte-identical with user-service)", () => {
    expect(crypto.createHash("sha256").update(fs.readFileSync(CONTRACT)).digest("hex")).toBe(CONTRACT_SHA256);
    expect(crypto.createHash("sha256").update(fs.readFileSync(V1)).digest("hex")).toBe(V1_SHA256);
    expect([contract.operation, contract.audience, contract.caller]).toEqual(["tenant_creditor_profile", "user-service", "profile-service"]);
  });
  test("every vector reproduces with the reused canonicalization (incl. the v1 compatibility vector)", () => {
    for (const v of contract.vectors) {
      const i = v.input;
      const body = sha256Hex(Buffer.from(i.body, "utf8"));
      const c = canonicalString({ aud: i.aud, caller: i.caller, kid: i.kid, method: i.method, target: i.target, tenant: i.tenant, idem: i.idem, bodySha256: body, ts: i.ts, nonce: i.nonce });
      expect({ name: v.name, body, c, sig: signCanonical(v.secret, c) }).toEqual({ name: v.name, body: v.expect.bodySha256, c: v.expect.canonical, sig: v.expect.sig });
    }
    expect(contract.vectors[1].expect.sig).not.toBe(contract.vectors[3].expect.sig); // tenant is bound
  });
  test("signedGetHeaders produces exactly the contract vector for the creditor-profile request", () => {
    const v = contract.vectors[1];
    const h = signedGetHeaders({ url: `http://user-service:5001${v.input.target}`, tenant: v.input.tenant, env: { USER_SIGNING_KID: v.input.kid, USER_SIGNING_SECRET: v.secret }, now: Number(v.input.ts) * 1000, nonce: v.input.nonce });
    expect(h).toEqual({ "x-svc-version": "1", "x-svc-caller": "profile-service", "x-svc-kid": v.input.kid, "x-svc-ts": v.input.ts, "x-svc-nonce": v.input.nonce, "x-svc-sig": v.expect.sig });
  });
  test("signing config: unset -> null; bad kid / short secret -> 503 USER_SIGNING_MISCONFIGURED", () => {
    expect(userSigningConfig({})).toBeNull();
    expect(() => userSigningConfig({ USER_SIGNING_KID: "bad kid", USER_SIGNING_SECRET: SECRET })).toThrow(expect.objectContaining({ status: 503, code: "USER_SIGNING_MISCONFIGURED" }));
    expect(() => userSigningConfig({ USER_SIGNING_KID: KID, USER_SIGNING_SECRET: "short" })).toThrow(expect.objectContaining({ status: 503 }));
  });
});

describe("fetchCreditorContext", () => {
  test("signed GET to the internal path; x-tenant-id + signature headers only; NO user / gateway identity forwarded", async () => {
    axios.get.mockResolvedValue({ status: 200, data: { data: { tenantId: TA, name: "Org A", code: "ORGA", branding: { primaryColor: "#000" }, organisationProfile: { iban: "IE29AIBK93115212345678", bic: "AIBKIE2DXXX" } } } });
    const ctx = await fetchCreditorContext(TA, req, { env: ENV });
    expect(ctx).toEqual({ branding: { primaryColor: "#000" }, organisationProfile: { iban: "IE29AIBK93115212345678", bic: "AIBKIE2DXXX" }, tenantName: "Org A" });
    const [url, opts] = axios.get.mock.calls[0];
    expect(new URL(url).pathname).toBe(`/internal/tenants/${TA}/creditor-profile`);
    expect(Object.keys(opts.headers).sort()).toEqual(["x-svc-caller", "x-svc-kid", "x-svc-nonce", "x-svc-sig", "x-svc-ts", "x-svc-version", "x-tenant-id"]);
    expect(Object.keys(opts.headers).filter((k) => IDENTITY.test(k))).toEqual([]);
    expect(opts.headers["x-tenant-id"]).toBe(TA);
    // the signature verifies against the verifier-side canonical string (method + exact path + x-tenant-id)
    const h = opts.headers;
    const c = canonicalString({ aud: "user-service", caller: "profile-service", kid: KID, method: "GET", target: `/internal/tenants/${TA}/creditor-profile`, tenant: TA, idem: "", bodySha256: sha256Hex(Buffer.alloc(0)), ts: h["x-svc-ts"], nonce: h["x-svc-nonce"] });
    expect(signCanonical(SECRET, c)).toBe(h["x-svc-sig"]);
  });

  test("a fresh nonce per call", async () => {
    axios.get.mockResolvedValue({ status: 200, data: { data: { tenantId: TA, organisationProfile: {} } } });
    await fetchCreditorContext(TA, req, { env: ENV });
    await fetchCreditorContext(TA, req, { env: ENV });
    expect(axios.get.mock.calls[0][1].headers["x-svc-nonce"]).not.toBe(axios.get.mock.calls[1][1].headers["x-svc-nonce"]);
  });

  test("non-200 (verifier off 503, rejected 401/403, 404), wrong tenant in the answer, network error -> 503 (never a blank snapshot)", async () => {
    for (const status of [401, 403, 404, 500, 503]) {
      axios.get.mockResolvedValueOnce({ status, data: {} });
      await expect(fetchCreditorContext(TA, req, { env: ENV })).rejects.toMatchObject({ status: 503, code: "CREDITOR_PROFILE_UNAVAILABLE" });
    }
    axios.get.mockResolvedValueOnce({ status: 200, data: { data: { tenantId: "bbbbbbbbbbbbbbbbbbbbbbbb", organisationProfile: { iban: "x" } } } });
    await expect(fetchCreditorContext(TA, req, { env: ENV })).rejects.toMatchObject({ status: 503 });
    axios.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(fetchCreditorContext(TA, req, { env: ENV })).rejects.toMatchObject({ status: 503 });
    await expect(fetchCreditorContext(null, req, { env: ENV })).rejects.toMatchObject({ status: 503 });
  });

  test("signing not configured -> 503 and NO request at all (no unsigned / forwarded-token call)", async () => {
    await expect(fetchCreditorContext(TA, req, { env: {} })).rejects.toMatchObject({ status: 503, code: "CREDITOR_PROFILE_UNAVAILABLE" });
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("misconfigured signing -> 503 USER_SIGNING_MISCONFIGURED, no request", async () => {
    await expect(fetchCreditorContext(TA, req, { env: { USER_SIGNING_KID: KID, USER_SIGNING_SECRET: "short" } })).rejects.toMatchObject({ status: 503, code: "USER_SIGNING_MISCONFIGURED" });
    expect(axios.get).not.toHaveBeenCalled();
  });

  test("rollback switch PAYMENT_FORM_CREDITOR_LEGACY_FETCH=on (default off): only while signing is NOT configured -> previous forwarded-token fetch", async () => {
    axios.get.mockResolvedValue({ status: 200, data: { data: { name: "Org A", organisationProfile: { legalName: "Org A Ltd" }, branding: {} } } });
    const ctx = await fetchCreditorContext(TA, req, { env: { PAYMENT_FORM_CREDITOR_LEGACY_FETCH: "on" } });
    expect(ctx.organisationProfile).toEqual({ legalName: "Org A Ltd" });
    const [url, opts] = axios.get.mock.calls[0];
    expect(new URL(url).pathname).toBe(`/api/tenants/${TA}`);
    expect(opts.headers.authorization).toBe("Bearer user-token");
    // with signing configured the switch is ignored
    axios.get.mockReset();
    axios.get.mockResolvedValue({ status: 200, data: { data: { tenantId: TA, organisationProfile: {} } } });
    await fetchCreditorContext(TA, req, { env: { ...ENV, PAYMENT_FORM_CREDITOR_LEGACY_FETCH: "on" } });
    expect(new URL(axios.get.mock.calls[0][0]).pathname).toBe(`/internal/tenants/${TA}/creditor-profile`);
  });
});

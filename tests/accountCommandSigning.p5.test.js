/**
 * P5 S3 signed service authority - profile-service signer (services/accountCommandSigning.js) and
 * its use on bound application capture / cancel (services/account.service.client.js).
 * contracts/p5-service-signing.v1.json is byte-identical in account-service, events-service and
 * profile-service; the SHA-256 is pinned here and in both other suites.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const SIGNING_VECTORS_SHA256 = "470d151d232a1acc00ae724afe05bc0986a0f5131fbc55861c3edd168383bf64";
const RAW = fs.readFileSync(path.join(__dirname, "..", "contracts", "p5-service-signing.v1.json"));
const V = JSON.parse(RAW.toString("utf8"));

const S = require("../services/accountCommandSigning");
const client = require("../services/account.service.client.js");

const BASE = "http://account-service:4000";
const T = "aaaaaaaaaaaaaaaaaaaaaaaa";
const SECRET = "TEST-ONLY-profile-signer-secret-0123456789abcdef";
const KEYS = ["ACCOUNT_PAYMENT_COMMAND_MODE", "ACCOUNT_SERVICE_URL", "ACCOUNT_SIGNING_KID", "ACCOUNT_SIGNING_SECRET"];
const saved = {};
let post;

beforeAll(() => {
  for (const k of KEYS) saved[k] = process.env[k];
});
afterAll(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
beforeEach(() => {
  process.env.ACCOUNT_PAYMENT_COMMAND_MODE = "bound";
  process.env.ACCOUNT_SERVICE_URL = BASE;
  process.env.ACCOUNT_SIGNING_KID = "pr-1";
  process.env.ACCOUNT_SIGNING_SECRET = SECRET;
  post = jest.spyOn(axios, "post").mockResolvedValue({ status: 200, data: { data: { status: "succeeded", paymentId: "c0000000000000000000000f" } } });
});
afterEach(() => jest.restoreAllMocks());

const req = { headers: { authorization: "Bearer contract-sentinel", "x-user-id": "u1" } };
const command = { applicationId: "d".repeat(24), actorUserId: "c".repeat(24), paymentId: "e".repeat(24) };

function verifySent(call, secret = SECRET) {
  const [url, body, cfg] = call;
  const raw = cfg.transformRequest[0](body, cfg.headers);
  expect(typeof raw).toBe("string");
  expect(JSON.parse(raw)).toEqual(body);
  const h = cfg.headers;
  const u = new URL(url);
  const canonical = S.canonicalString({
    caller: h["x-svc-caller"], kid: h["x-svc-kid"], method: "POST", target: `${u.pathname}${u.search}`,
    tenant: h["x-tenant-id"], idem: h["Idempotency-Key"], bodySha256: S.sha256Hex(Buffer.from(raw, "utf8")),
    ts: h["x-svc-ts"], nonce: h["x-svc-nonce"],
  });
  return crypto.timingSafeEqual(Buffer.from(S.signCanonical(secret, canonical)), Buffer.from(h["x-svc-sig"]));
}

test("shared vectors: pinned file; this signer reproduces every canonical string and signature", () => {
  expect(crypto.createHash("sha256").update(RAW).digest("hex")).toBe(SIGNING_VECTORS_SHA256);
  for (const v of V.vectors) {
    const { body, ...f } = v.input;
    const bodySha256 = S.sha256Hex(Buffer.from(body, "utf8"));
    expect(bodySha256).toBe(v.expect.bodySha256);
    const canonical = S.canonicalString({ ...f, bodySha256 });
    expect(canonical).toBe(v.expect.canonical);
    expect(S.signCanonical(v.secret, canonical)).toBe(v.expect.sig);
  }
});

const CALLS = [
  ["capture", () => client.capturePaymentIntent("pi_s3_app_1", T, req, command), "/api/payments/intents/pi_s3_app_1/capture"],
  ["cancel", () => client.cancelPaymentIntent("pi_s3_app_2", T, req, command), "/api/payments/intents/pi_s3_app_2/cancel"],
];

for (const [name, run, expectedPath] of CALLS) {
  test(`${name}: signed as profile-service over the exact transmitted bytes; never identity headers`, async () => {
    await run();
    expect(post).toHaveBeenCalledTimes(1);
    const call = post.mock.calls[0];
    expect(call[0]).toBe(`${BASE}${expectedPath}`);
    const h = call[2].headers;
    expect(h["x-svc-version"]).toBe("1");
    expect(h["x-svc-caller"]).toBe("profile-service");
    expect(h["x-svc-kid"]).toBe("pr-1");
    expect(verifySent(call)).toBe(true);
    for (const k of Object.keys(h)) expect(k.toLowerCase()).not.toMatch(/^(authorization|x-user-|x-jwt-verified|x-auth-source)/);
    expect(JSON.stringify(h)).not.toContain(SECRET);
  });
}

test("tampering with any signed element after signing breaks verification", async () => {
  await CALLS[0][1]();
  const [url, body, cfg] = post.mock.calls[0];
  const raw = cfg.transformRequest[0](body);
  const mut = [
    [url.replace("/capture", "/cancel"), cfg],
    [url + "?x=1", cfg],
    [url, { ...cfg, headers: { ...cfg.headers, "x-tenant-id": "f".repeat(24) } }],
    [url, { ...cfg, headers: { ...cfg.headers, "Idempotency-Key": "x" } }],
    [url, { ...cfg, headers: { ...cfg.headers, "x-svc-ts": "1" } }],
    [url, { ...cfg, headers: { ...cfg.headers, "x-svc-nonce": "AAAAAAAAAAAAAAAAAAAAAAAA" } }],
    [url, { ...cfg, transformRequest: [() => raw + " "] }],
  ];
  for (const [u, c] of mut) expect(verifySent([u, body, c])).toBe(false);
  expect(verifySent([url, body, cfg], "TEST-ONLY-some-other-services-secret-0000000")).toBe(false);
});

test("retry of the same business command: fresh nonce, same Idempotency-Key and body", async () => {
  await CALLS[0][1]();
  await CALLS[0][1]();
  const [a, b] = post.mock.calls.map((c) => c[2].headers);
  expect(a["Idempotency-Key"]).toBe(b["Idempotency-Key"]);
  expect(a["x-svc-nonce"]).not.toBe(b["x-svc-nonce"]);
  expect(post.mock.calls[0][2].transformRequest[0]()).toBe(post.mock.calls[1][2].transformRequest[0]());
});

test("not configured (R0): no signature headers", async () => {
  delete process.env.ACCOUNT_SIGNING_KID;
  delete process.env.ACCOUNT_SIGNING_SECRET;
  await CALLS[0][1]();
  expect(Object.keys(post.mock.calls[0][2].headers).filter((k) => k.startsWith("x-svc-"))).toEqual([]);
});

test("misconfigured (short secret / bad kid) fails closed before any request", async () => {
  process.env.ACCOUNT_SIGNING_SECRET = "short";
  await expect(CALLS[0][1]()).rejects.toMatchObject({ code: "ACCOUNT_SIGNING_MISCONFIGURED", statusCode: 503 });
  process.env.ACCOUNT_SIGNING_SECRET = SECRET;
  process.env.ACCOUNT_SIGNING_KID = "bad kid";
  await expect(CALLS[0][1]()).rejects.toMatchObject({ code: "ACCOUNT_SIGNING_MISCONFIGURED" });
  expect(post).not.toHaveBeenCalled();
});

test("the signer never writes the secret or signature to the console", async () => {
  const spies = ["log", "info", "warn", "error"].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
  await CALLS[0][1]();
  const sig = post.mock.calls[0][2].headers["x-svc-sig"];
  const text = JSON.stringify(spies.flatMap((s) => s.mock.calls));
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain(sig);
});

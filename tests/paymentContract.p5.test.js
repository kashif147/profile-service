/**
 * P5 cross-service payment command contract - profile-service (caller side).
 *
 * contracts/p5-bound-payment-commands.v1.json is committed byte-identically in account-service,
 * events-service and profile-service (SHA-256 pinned below and in the other two repos). Every
 * profile-service case is produced through the REAL account client (bound mode) and the request
 * actually handed to axios must equal the fixture's `request` exactly: path, headers (only the
 * contract's allowed headers; never identity), and body. account-service replays the same
 * requests against its real router (src/tests/paymentContract.p5.test.mjs).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const CONTRACT_SHA256 = "f0d9d619e1f17c3868d4dc6b73772bdeeebbe0b6e48cd11e245ad9116253a065";
const RAW = fs.readFileSync(path.join(__dirname, "../contracts/p5-bound-payment-commands.v1.json"));
const C = JSON.parse(RAW.toString("utf8"));

const accountClient = require("../services/account.service.client.js");

const BASE = "http://account-service:4000";
let post;
const saved = {};
beforeEach(() => {
  for (const k of ["ACCOUNT_PAYMENT_COMMAND_MODE", "ACCOUNT_SERVICE_URL"]) saved[k] = process.env[k];
  process.env.ACCOUNT_PAYMENT_COMMAND_MODE = "bound";
  process.env.ACCOUNT_SERVICE_URL = BASE;
  post = jest.spyOn(axios, "post").mockResolvedValue({ status: 200, data: { data: { status: "succeeded" } } });
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  jest.restoreAllMocks();
});

// The inbound CRM request carries a full user identity: none of it may reach account.
const inboundReq = {
  headers: {
    authorization: "Bearer contract-sentinel",
    "x-jwt-verified": "true",
    "x-auth-source": "gateway",
    "x-user-id": C.ids.actorUserId,
    "x-user-type": "CRM",
    "x-user-permissions": "application:write",
  },
};

const CALLS = {
  capture: (c) => accountClient.capturePaymentIntent(c.inputs.paymentIntentId, C.ids.tenantId, inboundReq, {
    applicationId: c.inputs.applicationId, actorUserId: C.ids.actorUserId, paymentId: c.inputs.paymentId,
  }),
  cancel: (c) => accountClient.cancelPaymentIntent(c.inputs.paymentIntentId, C.ids.tenantId, inboundReq, {
    applicationId: c.inputs.applicationId, actorUserId: C.ids.actorUserId, paymentId: c.inputs.paymentId,
  }),
};

test("contract fixture is the pinned version (byte-identical across the three repos)", () => {
  expect(crypto.createHash("sha256").update(RAW).digest("hex")).toBe(CONTRACT_SHA256);
  expect(C.contract).toBe("p5-bound-payment-commands");
  expect(C.version).toBe(1);
});

const mine = C.cases.filter((c) => c.caller === "profile-service");
test("every profile-service transition in the contract is covered", () => {
  expect(mine.map((c) => c.name).sort()).toEqual(["application.cancel.reject", "application.capture.approve"]);
});

test.each(mine.map((c) => [c.name, c]))("%s: the serialized request equals the contract", async (_name, c) => {
  const [, transition] = c.name.split(".");
  await CALLS[transition](c);
  expect(post).toHaveBeenCalledTimes(1);
  const [url, body, cfg] = post.mock.calls[0];
  expect(url).toBe(`${BASE}${c.request.path}`);
  const sent = { ...cfg.headers };
  expect(sent["Content-Type"]).toBe("application/json");
  delete sent["Content-Type"];
  delete sent["x-correlation-id"];
  expect(sent).toEqual(c.request.headers);
  for (const h of Object.keys(cfg.headers)) expect(C.rules.allowedHeaders).toContain(h.toLowerCase());
  expect(JSON.stringify(cfg.headers)).not.toContain("contract-sentinel");
  expect(body).toEqual(c.request.body);
});

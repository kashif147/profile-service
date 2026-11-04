"use strict";
/**
 * PDP rollout P3 (Q2): plaintext debtor IBAN/BIC on CRM payment-form routes only with payments.bank:read (or ASU's
 * computed "*"); masked otherwise - detail, write responses and the CRM PDF. The SEPA prepare feed needs the claim
 * and a non-empty profileIds list. Portal routes unchanged (never plaintext).
 * Synthetic, validator-safe values only (the IBAN is the published example number).
 */
process.env.PAYMENT_FORM_ENCRYPTION_KEY = "p3-test-only-key";

jest.mock("../models/profile.model.js", () =>
  require("./helpers/memoryModel").createMemoryModel("Profile"),
);
jest.mock("../models/user.model.js", () =>
  require("./helpers/memoryModel").createMemoryModel("User"),
);
jest.mock("../models/memberPaymentForm.model.js", () => ({
  MemberPaymentForm: require("./helpers/memoryModel").createMemoryModel("MemberPaymentForm"),
  PAYMENT_FORM_TYPES: ["STANDING_ORDER", "SALARY_DEDUCTION", "DD_MANDATE"],
  PAYMENT_FORM_STATUSES: ["draft", "generated", "submitted", "verified", "active", "rejected", "superseded"],
}));
jest.mock("../services/azure.blob.service.js", () => ({
  getDownloadSasUrl: jest.fn(() => null),
  buildPaymentFormBlobPath: jest.fn(() => "blob/path"),
  uploadToBlob: jest.fn(async () => undefined),
}));
jest.mock("../services/tenant.service.client.js", () => ({
  fetchTenantContext: jest.fn(),
  fetchCreditorContext: jest.fn(),
  formatOrgAddress: jest.fn(() => ""),
  formatBankAddress: jest.fn(() => ""),
}));
jest.mock("../services/subscription.service.client.js", () => ({
  fetchCurrentSubscriptionByProfileId: jest.fn(),
  SUBSCRIPTION_SERVICE_URL: "http://subscription-service",
}));
jest.mock("../rabbitMQ/publishers/paymentForm.publisher.js", () => ({
  publishPaymentFormApproved: jest.fn(),
  publishMemberNotificationRequested: jest.fn(),
}));

const Profile = require("../models/profile.model.js");
const User = require("../models/user.model.js");
const { MemberPaymentForm } = require("../models/memberPaymentForm.model.js");
const { encryptField } = require("../helpers/paymentFormCrypto.js");
const svc = require("../services/paymentForm.service.js");
const controller = require("../controllers/paymentForm.controller.js");
const { canReadBankData, requireBankDataRead } = require("../helpers/bankDataAccess.js");
const { maskIban } = require("../helpers/iban.js");

const TA = "aaaaaaaaaaaaaaaaaaaaaaaa";
const PA = "a00000000000000000000001";
const SA = "a20000000000000000000001";
const F_DD = "f00000000000000000000001";
const F_ACTIVE = "f00000000000000000000002";
const EXAMPLE_IBAN = "IE29AIBK93115212345678";
const EXAMPLE_BIC = "AIBKIE2D";
const MASKED = maskIban(EXAMPLE_IBAN);

const crm = (permissions) => ({
  user: { id: "c00000000000000000000009", userType: "CRM", tenantId: TA, permissions },
  permissions,
  tenantId: TA,
  userId: "c00000000000000000000009",
  headers: {},
  params: {},
  body: {},
  query: {},
});
const CRM_NO_BANK = () => crm(["payments:read", "payments:write"]);
const CRM_BANK = () => crm(["payments:read", "payments:write", "payments.bank:read"]);
const ASU = () => crm(["*"]);
const PORTAL_BANK = () => ({
  user: { id: SA, userType: "PORTAL", tenantId: TA, permissions: ["payments.bank:read", "*"] },
  permissions: ["payments.bank:read", "*"],
  tenantId: TA,
  userId: SA,
  headers: {},
});

function form(_id, status, extra = {}) {
  return {
    _id,
    tenantId: TA,
    profileId: PA,
    userId: null,
    formType: "DD_MANDATE",
    status,
    visibility: { portalVisible: true },
    directDebitMandate: { debtorIban: encryptField(EXAMPLE_IBAN), debtorBic: encryptField(EXAMPLE_BIC), isAuthorized: true },
    auditTrail: [],
    meta: {},
    ...extra,
  };
}

beforeEach(() => {
  Profile.reset();
  User.reset();
  MemberPaymentForm.reset();
  Profile.seed([{ _id: PA, tenantId: TA, userId: null, isActive: true, membershipNumber: "M-1" }]);
  MemberPaymentForm.seed([form(F_DD, "submitted"), form(F_ACTIVE, "active")]);
});

function resCapture() {
  const r = { statusCode: 200, headers: {}, body: undefined };
  r.status = (c) => ((r.statusCode = c), r);
  r.success = (b) => ((r.body = b), r);
  r.setHeader = (k, v) => (r.headers[k] = v);
  r.send = (b) => ((r.body = b), r);
  return r;
}
async function run(handler, req) {
  const res = resCapture();
  let err = null;
  await handler(req, res, (e) => (err = e || null));
  return { res, err };
}
const plaintext = (out) => {
  const m = out.directDebitMandate || {};
  return m.debtorIbanPlain === EXAMPLE_IBAN && m.debtorBicPlain === EXAMPLE_BIC;
};
const masked = (out) => {
  const m = out.directDebitMandate || {};
  return (
    m.debtorIbanDisplay === MASKED &&
    m.debtorIbanPlain === undefined &&
    m.debtorIban === undefined &&
    m.debtorBic === undefined &&
    m.debtorBicPlain === undefined &&
    !JSON.stringify(out).includes(EXAMPLE_IBAN)
  );
};

describe("canReadBankData (literal claim, CRM only)", () => {
  test("payments.bank:read or * on a CRM caller; nothing else", () => {
    expect(canReadBankData(CRM_BANK())).toBe(true);
    expect(canReadBankData(ASU())).toBe(true);
    expect(canReadBankData(CRM_NO_BANK())).toBe(false);
    expect(canReadBankData(crm(["payments:*", "admin", "PAYMENTS.BANK_READ", "payments.bank:write"]))).toBe(false);
    expect(canReadBankData(PORTAL_BANK())).toBe(false);
    expect(canReadBankData({ headers: {}, body: { permissions: ["*"] }, query: { permissions: ["*"] } })).toBe(false);
  });
  test("requireBankDataRead -> 403 BANK_DATA_PERMISSION_REQUIRED without the claim", () => {
    const next = jest.fn();
    requireBankDataRead(CRM_NO_BANK(), {}, next);
    expect(next.mock.calls[0][0]).toMatchObject({ status: 403, code: "BANK_DATA_PERMISSION_REQUIRED" });
    const ok = jest.fn();
    requireBankDataRead(CRM_BANK(), {}, ok);
    expect(ok).toHaveBeenCalledWith();
  });
});

describe("CRM GET /payment-forms/:id", () => {
  test("without the claim: masked; with payments.bank:read or *: plaintext", async () => {
    const a = await run(controller.getPaymentFormById, { ...CRM_NO_BANK(), params: { id: F_DD } });
    expect(a.err).toBeNull();
    expect(masked(a.res.body.paymentForm)).toBe(true);
    for (const req of [CRM_BANK(), ASU()]) {
      const b = await run(controller.getPaymentFormById, { ...req, params: { id: F_DD } });
      expect(plaintext(b.res.body.paymentForm)).toBe(true);
    }
  });
});

describe("CRM write responses", () => {
  test("reject: masked without the claim, plaintext with it", async () => {
    expect(masked(await svc.rejectForm(F_DD, TA, CRM_NO_BANK(), "r"))).toBe(true);
    expect(plaintext(await svc.rejectForm(F_DD, TA, CRM_BANK(), "r"))).toBe(true);
  });
  test("no CRM response path hard-codes plaintext any more (source guard)", () => {
    const fs = require("fs");
    const src = fs.readFileSync(require.resolve("../services/paymentForm.service.js"), "utf8");
    // The only remaining literal is the SEPA feed (listDirectDebitMandatesForPrepare), gated at the route.
    const literal = [...src.matchAll(/includeSensitive:\s*true/g)].map((m) => m.index);
    expect(literal).toHaveLength(1);
    expect(literal[0]).toBeGreaterThan(src.indexOf("async function listDirectDebitMandatesForPrepare"));
    expect(src).not.toMatch(/includeSensitive:\s*!portal\s*[,}]/);
    expect(src).not.toMatch(/includeSensitive:\s*source !== "portal"\s*[,}]/);
  });
});

describe("CRM PDF download", () => {
  test("the PDF is rendered from the masked form without the claim, plaintext with it", async () => {
    const spy = jest.spyOn(svc, "exportFormPdf").mockResolvedValue({ buffer: Buffer.from("pdf"), filename: "f.pdf", contentType: "application/pdf" });
    try {
      await run(controller.downloadPaymentFormPdf, { ...CRM_NO_BANK(), params: { id: F_DD } });
      await run(controller.downloadPaymentFormPdf, { ...CRM_BANK(), params: { id: F_DD } });
      expect(spy.mock.calls.map((c) => c[2])).toEqual([{ includeSensitive: false }, { includeSensitive: true }]);
    } finally {
      spy.mockRestore();
    }
  });
  test("exportFormPdf defaults to the masked view", async () => {
    const getById = jest.spyOn(svc, "getById");
    // getById is called internally (not via the export object), so assert on the rendered input instead:
    const pdf = require("../services/paymentFormPdf.service.js");
    const build = jest.spyOn(pdf, "buildPaymentFormPdfBuffer").mockResolvedValue(Buffer.from("pdf"));
    try {
      await svc.exportFormPdf(F_DD, TA);
      expect(masked(build.mock.calls[0][0])).toBe(true);
      await svc.exportFormPdf(F_DD, TA, { includeSensitive: true });
      expect(plaintext(build.mock.calls[1][0])).toBe(true);
    } finally {
      build.mockRestore();
      getById.mockRestore();
    }
  });
});

describe("SEPA prepare feed", () => {
  test("service: empty or invalid-only profileIds -> 400 PROFILE_IDS_REQUIRED (no 'all mandates' mode)", async () => {
    await expect(svc.listDirectDebitMandatesForPrepare({ tenantId: TA, profileIds: [] })).rejects.toMatchObject({ status: 400, code: "PROFILE_IDS_REQUIRED" });
    await expect(svc.listDirectDebitMandatesForPrepare({ tenantId: TA, profileIds: ["nope", ""] })).rejects.toMatchObject({ status: 400 });
    const rows = await svc.listDirectDebitMandatesForPrepare({ tenantId: TA, profileIds: [PA] });
    expect(rows).toHaveLength(1);
    expect(rows[0].mandate.debtorIban).toBe(EXAMPLE_IBAN);
  });

  test("PUT /filter purpose direct-debit-prepare: 403 without the claim; with it non-empty ids required", async () => {
    const noBank = await run(controller.filterPaymentForms, { ...CRM_NO_BANK(), body: { purpose: "direct-debit-prepare", profileIds: [PA] } });
    expect(noBank.err).toMatchObject({ status: 403, code: "BANK_DATA_PERMISSION_REQUIRED" });
    const empty = await run(controller.filterPaymentForms, { ...CRM_BANK(), body: { purpose: "direct-debit-prepare", profileIds: [] } });
    expect(empty.err).toMatchObject({ status: 400, code: "PROFILE_IDS_REQUIRED" });
    const ok = await run(controller.filterPaymentForms, { ...CRM_BANK(), body: { purpose: "direct-debit-prepare", profileIds: [PA] } });
    expect(ok.err).toBeNull();
    expect(ok.res.body.mandates).toHaveLength(1);
  });

  test("PUT /filter without the prepare purpose is the masked grid (unchanged, no claim needed)", async () => {
    const r = await run(controller.filterPaymentForms, { ...CRM_NO_BANK(), body: {} });
    expect(r.err).toBeNull();
    expect(JSON.stringify(r.res.body)).not.toContain(EXAMPLE_IBAN);
  });
});

describe("portal unchanged", () => {
  test("portal getById never returns plaintext, even with payments.bank:read / * claims", async () => {
    MemberPaymentForm.seed([form("f00000000000000000000009", "draft", { userId: SA })]);
    User.seed([{ _id: "a10000000000000000000001", userId: SA, tenantId: TA, userType: "PORTAL", isActive: true }]);
    await Profile.updateOne({ _id: PA }, { $set: { userId: "a10000000000000000000001" } });
    const out = await svc.getByIdForPortal("f00000000000000000000009", TA, PORTAL_BANK());
    expect(masked(out)).toBe(true);
  });
});

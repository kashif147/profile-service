"use strict";
/**
 * P5 payment-form portal ownership + field redaction (services/paymentForm.service.js).
 * A portal caller may act only on forms of its OWN profile; another member's form, a form with no
 * owner binding to the caller, another tenant's form and a missing id all give the same 403, and
 * nothing is changed. Portal responses never carry plaintext IBAN/BIC.
 * Synthetic, validator-safe values only (the IBAN is the published example number).
 */
process.env.PAYMENT_FORM_ENCRYPTION_KEY = "p5-test-only-key";

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

const TA = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TB = "bbbbbbbbbbbbbbbbbbbbbbbb";
const PA = "a00000000000000000000001";
const PB = "a00000000000000000000002";
const PC = "b00000000000000000000003";
const LA = "a10000000000000000000001";
const LB = "a10000000000000000000002";
const SA = "a20000000000000000000001";
const SB = "a20000000000000000000002";
const F_A_PORTAL = "f00000000000000000000001"; // A's own portal-created form
const F_A_CRM = "f00000000000000000000011"; // CRM-created on A's profile (userId = A's local User id)
const F_A_NOOWNER = "f00000000000000000000021"; // A's profile, no userId
const F_B = "f00000000000000000000002"; // B's form
const F_B_NOOWNER = "f00000000000000000000022"; // B's profile, no userId
const F_C = "f00000000000000000000003"; // tenant B
const F_MISMATCH = "f00000000000000000000031"; // A's profile but bound to B's user id
const MISSING = "f000000000000000000000ff";
const EXAMPLE_IBAN = "IE29AIBK93115212345678";
const EXAMPLE_BIC = "AIBKIE2D";

const reqA = { userId: SA, user: { id: SA, userType: "PORTAL", tenantId: TA }, tenantId: TA, headers: {} };

function form(_id, tenantId, profileId, userId, status = "draft") {
  return {
    _id,
    tenantId,
    profileId,
    userId,
    formType: "DD_MANDATE",
    status,
    visibility: { portalVisible: true },
    directDebitMandate: { debtorIban: encryptField(EXAMPLE_IBAN), debtorBic: encryptField(EXAMPLE_BIC) },
    auditTrail: [],
    meta: {},
  };
}

beforeEach(() => {
  Profile.reset();
  User.reset();
  MemberPaymentForm.reset();
  Profile.seed([
    { _id: PA, tenantId: TA, userId: LA, isActive: true },
    { _id: PB, tenantId: TA, userId: LB, isActive: true },
    { _id: PC, tenantId: TB, userId: null, isActive: true },
  ]);
  User.seed([
    { _id: LA, userId: SA, tenantId: TA, userType: "PORTAL", isActive: true },
    { _id: LB, userId: SB, tenantId: TA, userType: "PORTAL", isActive: true },
  ]);
  MemberPaymentForm.seed([
    form(F_A_PORTAL, TA, PA, SA),
    form(F_A_CRM, TA, PA, LA),
    form(F_A_NOOWNER, TA, PA, null),
    form(F_B, TA, PB, SB),
    form(F_B_NOOWNER, TA, PB, null),
    form(F_C, TB, PC, null),
    form(F_MISMATCH, TA, PA, SB),
  ]);
});

function noPlaintext(out) {
  const m = out.directDebitMandate || {};
  expect(m.debtorIban).toBeUndefined();
  expect(m.debtorBic).toBeUndefined();
  expect(m.debtorIbanPlain).toBeUndefined();
  expect(m.debtorBicPlain).toBeUndefined();
  expect(JSON.stringify(out)).not.toContain(EXAMPLE_IBAN);
  expect(JSON.stringify(out)).not.toContain(EXAMPLE_BIC);
}

async function status(p) {
  try {
    await p;
    return 200;
  } catch (e) {
    return e.status || 500;
  }
}

describe("portal GET by id (getByIdForPortal)", () => {
  test.each([F_A_PORTAL, F_A_CRM, F_A_NOOWNER])("A on own form %s -> allowed, masked", async (id) => {
    const out = await svc.getByIdForPortal(id, TA, reqA);
    noPlaintext(out);
    expect(out.directDebitMandate.debtorIbanDisplay).toBeTruthy(); // masked display only
  });

  test.each([
    ["B's form (same tenant)", F_B, TA],
    ["B's form with no owner", F_B_NOOWNER, TA],
    ["form on A's profile bound to B's user", F_MISMATCH, TA],
    ["tenant-B form addressed in A's tenant", F_C, TA],
    ["missing id", MISSING, TA],
  ])("A on %s -> 403", async (_label, id, tenant) => {
    expect(await status(svc.getByIdForPortal(id, tenant, reqA))).toBe(403);
  });

  test("a CRM caller id never owns a portal form", async () => {
    const reqCrm = { userId: "c00000000000000000000009", user: { userType: "CRM" }, tenantId: TA, headers: {} };
    expect(await status(svc.getByIdForPortal(F_A_NOOWNER, TA, reqCrm))).toBe(403);
  });
});

describe("portal mutations: A on B is denied and nothing changes", () => {
  test("updateForm(portal) on B's form", async () => {
    const before = JSON.stringify(await MemberPaymentForm.findOne({ _id: F_B }).lean());
    expect(await status(svc.updateForm(F_B, TA, { status: "active" }, reqA, { portal: true }))).toBe(403);
    expect(JSON.stringify(await MemberPaymentForm.findOne({ _id: F_B }).lean())).toBe(before);
  });

  test("submitForm(portal) on B's ownerless form", async () => {
    const before = JSON.stringify(await MemberPaymentForm.findOne({ _id: F_B_NOOWNER }).lean());
    expect(await status(svc.submitForm(F_B_NOOWNER, TA, reqA, { portal: true }))).toBe(403);
    expect(JSON.stringify(await MemberPaymentForm.findOne({ _id: F_B_NOOWNER }).lean())).toBe(before);
  });

  test("uploadSignature(portal) on another tenant's form", async () => {
    expect(
      await status(
        svc.uploadSignature(F_C, TA, { imageBase64: "data:image/png;base64,AAAA", slot: 0 }, reqA, { portal: true }),
      ),
    ).toBe(403);
  });

  test("updateForm(portal) on own draft is allowed and returns no plaintext", async () => {
    const out = await svc.updateForm(F_A_PORTAL, TA, {}, reqA, { portal: true });
    noPlaintext(out);
  });
});

describe("CRM (non-portal) service path is unchanged", () => {
  test("getById with includeSensitive returns the CRM plaintext view", async () => {
    const out = await svc.getById(F_B, TA, { includeSensitive: true });
    expect(out.directDebitMandate.debtorIbanPlain).toBe(EXAMPLE_IBAN);
  });

  test("CRM update of a missing form is still 404", async () => {
    expect(await status(svc.updateForm(MISSING, TA, {}, reqA, { portal: false }))).toBe(404);
  });
});

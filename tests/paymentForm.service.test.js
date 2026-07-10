const mongoose = require("mongoose");

const mockProfileFindOne = jest.fn();
const mockPaymentFormFind = jest.fn();
const mockGetDownloadSasUrl = jest.fn();

jest.mock("../models/profile.model.js", () => ({
  findOne: mockProfileFindOne,
}));

jest.mock("../models/user.model.js", () => ({
  findOne: jest.fn(),
}));

jest.mock("../models/memberPaymentForm.model.js", () => ({
  MemberPaymentForm: {
    find: mockPaymentFormFind,
  },
  PAYMENT_FORM_TYPES: ["STANDING_ORDER", "SALARY_DEDUCTION", "DD_MANDATE"],
  PAYMENT_FORM_STATUSES: [
    "draft",
    "generated",
    "submitted",
    "verified",
    "active",
    "rejected",
    "superseded",
  ],
}));

jest.mock("../services/azure.blob.service.js", () => ({
  getDownloadSasUrl: mockGetDownloadSasUrl,
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

const paymentFormService = require("../services/paymentForm.service.js");

function queryWithLean(result) {
  return { lean: jest.fn().mockResolvedValue(result) };
}

function queryWithSort(result) {
  return { sort: jest.fn().mockResolvedValue(result) };
}

describe("payment form service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDownloadSasUrl.mockReturnValue("https://blob.example/signature.png");
  });

  test("returns full masked portal form details from profile lists", async () => {
    const profileId = new mongoose.Types.ObjectId();
    const formId = new mongoose.Types.ObjectId();
    const signatureDates = [
      new Date("2026-05-23T00:00:00.000Z"),
      new Date("2026-05-24T00:00:00.000Z"),
    ];

    mockProfileFindOne.mockReturnValue(
      queryWithLean({
        _id: profileId,
        tenantId: "tenant-1",
        membershipNumber: "B00003",
      }),
    );
    mockPaymentFormFind.mockReturnValue(
      queryWithSort([
        {
          _id: formId,
          tenantId: "tenant-1",
          profileId,
          membershipNumber: "B00003",
          formType: "STANDING_ORDER",
          status: "submitted",
          source: "portal",
          createdAt: new Date("2026-05-20T00:00:00.000Z"),
          updatedAt: new Date("2026-05-25T00:00:00.000Z"),
          organisationSnapshot: { legalName: "Union Example" },
          standingOrder: {
            beneficiaryAccountName: "Union Example",
            beneficiaryBankName: "AIB",
            beneficiaryAddress: "1 Bank Centre",
            beneficiaryIban: "IE29AIBK93115212345678",
            beneficiaryBic: "AIBKIE2D",
            beneficiaryReference: "B00003",
            debtorAccountName: "Jane Member",
            debtorIban: { value: "IE29AIBK93115212345678", encrypted: false },
            debtorBic: { value: "AIBKIE2D", encrypted: false },
            paymentFrequency: "Monthly",
            installmentAmountEur: 45,
            signatureDates,
            signatureBlobPaths: ["payment-forms/signature-1.png"],
          },
          gdpr: { consentCapturedAt: new Date("2026-05-23T12:00:00.000Z") },
          visibility: { portalVisible: true },
        },
      ]),
    );

    const result = await paymentFormService.listForProfile(profileId, "tenant-1", {
      portalUserId: "portal-user-1",
    });

    expect(result).toHaveLength(1);
    expect(result[0].standingOrder).toEqual(
      expect.objectContaining({
        beneficiaryAccountName: "Union Example",
        beneficiaryBankName: "AIB",
        beneficiaryAddress: "1 Bank Centre",
        beneficiaryIban: "IE29AIBK93115212345678",
        beneficiaryBic: "AIBKIE2D",
        beneficiaryReference: "B00003",
        debtorMessage: "B00003",
        signatureDates,
        debtorIbanDisplay: "IE29****5678",
      }),
    );
    expect(result[0].standingOrder.debtorIban).toBeUndefined();
    expect(result[0].standingOrder.debtorBic).toBeUndefined();
    expect(result[0].downloadUrls.signatures).toEqual([
      "https://blob.example/signature.png",
    ]);
  });
});

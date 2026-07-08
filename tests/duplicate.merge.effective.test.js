const mockProfileFindOne = jest.fn();
const mockProfileUpdateOne = jest.fn();
const mockReassignProfileServiceReferences = jest.fn();
const mockConsolidateProfileMergeHistory = jest.fn();
const mockPublishProfileDuplicateMergedAudit = jest.fn();

jest.mock("../models/personal.details.model.js", () => ({}));
jest.mock("../models/profile.model.js", () => ({
  findOne: mockProfileFindOne,
  updateOne: mockProfileUpdateOne,
}));
jest.mock("../models/professional.details.model.js", () => ({}));
jest.mock("../models/subscription.model.js", () => ({}));
jest.mock("../services/submission.service.js", () => ({
  loadSubmission: jest.fn(),
}));
jest.mock("../services/subscription.service.client.js", () => ({
  fetchCurrentSubscriptionByProfileId: jest.fn(),
}));
jest.mock("../services/account.service.client.js", () => ({
  fetchMemberFinanceSummary: jest.fn(),
}));
jest.mock("../services/profile.merge.consolidation.service.js", () => ({
  reassignProfileServiceReferences: mockReassignProfileServiceReferences,
  consolidateProfileMergeHistory: mockConsolidateProfileMergeHistory,
}));
jest.mock("../services/profile.duplicate.audit.publisher.js", () => ({
  publishProfileDuplicateMergedAudit: mockPublishProfileDuplicateMergedAudit,
}));
jest.mock("../services/duplicate.matching.js", () => ({
  findAuthorizedProfileMatch: jest.fn(),
}));

const {
  buildEffectiveFromMergeChoices,
  executeProfileDuplicateMerge,
} = require("../services/duplicate.merge.service.js");
const {
  fetchCurrentSubscriptionByProfileId,
} = require("../services/subscription.service.client.js");
const mongoose = require("mongoose");

describe("buildEffectiveFromMergeChoices", () => {
  const profileDoc = {
    personalInfo: { forename: "Mary", surname: "Member" },
    contactInfo: { personalEmail: "mary@example.com", mobileNumber: "0871111111" },
    professionalDetails: {
      workLocation: "Dublin",
      payrollNo: "P-EXISTING",
    },
    preferences: {},
    cornMarket: {},
    additionalInformation: {},
    recruitmentDetails: {},
  };

  const effective = {
    personalInfo: { forename: "John", surname: "Applicant" },
    contactInfo: { personalEmail: "john@example.com", mobileNumber: "0872222222" },
    professionalDetails: {
      workLocation: "Cork",
      payrollNo: "P-NEW",
    },
    subscriptionDetails: {
      membershipCategory: "full-time",
      paymentType: "Payroll Deduction",
      paymentFrequency: "Monthly",
      dateJoined: "2026-01-15",
    },
  };

  const liveSubscription = {
    membershipCategory: "associate",
    paymentType: "Direct Debit",
    paymentFrequency: "Annually",
    payrollNo: "P-EXISTING",
    startDate: "2020-06-01",
  };

  test("keeps application values when APPLICATION is chosen", () => {
    const merged = buildEffectiveFromMergeChoices(
      effective,
      profileDoc,
      {
        "personalInfo.forename": "APPLICATION",
        "contactInfo.personalEmail": "APPLICATION",
        "professionalDetails.workLocation": "APPLICATION",
        "subscriptionDetails.paymentType": "APPLICATION",
      },
      liveSubscription,
    );

    expect(merged.personalInfo.forename).toBe("John");
    expect(merged.contactInfo.personalEmail).toBe("john@example.com");
    expect(merged.professionalDetails.workLocation).toBe("Cork");
    expect(merged.subscriptionDetails.paymentType).toBe("Payroll Deduction");
  });

  test("keeps profile values when PROFILE is chosen", () => {
    const merged = buildEffectiveFromMergeChoices(
      effective,
      profileDoc,
      {
        "personalInfo.forename": "PROFILE",
        "contactInfo.mobileNumber": "PROFILE",
        "professionalDetails.payrollNo": "PROFILE",
        "subscriptionDetails.membershipCategory": "PROFILE",
        "subscriptionDetails.paymentFrequency": "PROFILE",
      },
      liveSubscription,
    );

    expect(merged.personalInfo.forename).toBe("Mary");
    expect(merged.contactInfo.mobileNumber).toBe("0871111111");
    expect(merged.professionalDetails.payrollNo).toBe("P-EXISTING");
    expect(merged.subscriptionDetails.membershipCategory).toBe("associate");
    expect(merged.subscriptionDetails.paymentFrequency).toBe("Annually");
  });

  test("maps profile subscription startDate onto application dateJoined", () => {
    const merged = buildEffectiveFromMergeChoices(
      effective,
      profileDoc,
      {
        "subscriptionDetails.startDate": "PROFILE",
      },
      liveSubscription,
    );

    expect(merged.subscriptionDetails.dateJoined).toBe("2020-06-01");
  });
});

describe("executeProfileDuplicateMerge transaction handling", () => {
  const masterProfileId = "6a4d47f7c060a977a3b332ef";
  const absorbedProfileId = "6a4d47f7c060a977a3b332ee";
  const tenantId = "tenant-1";

  let startSessionSpy;
  let mockSession;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSession = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn(),
    };
    startSessionSpy = jest
      .spyOn(mongoose, "startSession")
      .mockResolvedValue(mockSession);

    const masterProfile = {
      _id: new mongoose.Types.ObjectId(masterProfileId),
      tenantId,
      membershipNumber: "M001",
      personalInfo: { forename: "Master", surname: "Member" },
      contactInfo: { personalEmail: "master@example.com" },
      professionalDetails: {},
      preferences: {},
      cornMarket: {},
      additionalInformation: {},
      recruitmentDetails: {},
    };
    const absorbedProfile = {
      _id: new mongoose.Types.ObjectId(absorbedProfileId),
      tenantId,
      membershipNumber: "M002",
      personalInfo: { forename: "Absorbed", surname: "Member" },
      contactInfo: { personalEmail: "absorbed@example.com" },
      professionalDetails: {},
      preferences: {},
      cornMarket: {},
      additionalInformation: {},
      recruitmentDetails: {},
    };
    const updatedProfile = {
      ...masterProfile,
      personalInfo: { forename: "Updated", surname: "Member" },
    };

    mockProfileFindOne
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue(masterProfile),
      })
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue(absorbedProfile),
      })
      .mockReturnValueOnce({
        session: jest.fn().mockResolvedValue(updatedProfile),
      });
    mockProfileUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    fetchCurrentSubscriptionByProfileId.mockResolvedValue(null);
    mockReassignProfileServiceReferences.mockResolvedValue({
      paymentFormsReassigned: 1,
    });
    mockConsolidateProfileMergeHistory.mockRejectedValue(
      new Error("remote consolidation failed"),
    );
    mockPublishProfileDuplicateMergedAudit.mockResolvedValue(undefined);
  });

  afterEach(() => {
    startSessionSpy.mockRestore();
  });

  test("does not abort an already committed transaction when post-commit consolidation fails", async () => {
    await expect(
      executeProfileDuplicateMerge({
        masterProfileId,
        absorbedProfileId,
        tenantId,
        mergeFieldChoices: {
          "personalInfo.forename": "PROFILE",
        },
        reviewerId: "reviewer-1",
      }),
    ).rejects.toThrow("remote consolidation failed");

    expect(mockSession.commitTransaction).toHaveBeenCalledTimes(1);
    expect(mockSession.abortTransaction).not.toHaveBeenCalled();
    expect(mockSession.endSession).toHaveBeenCalledTimes(1);
  });
});

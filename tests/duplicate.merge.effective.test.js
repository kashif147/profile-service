jest.mock("../models/personal.details.model.js", () => ({}));
jest.mock("../models/profile.model.js", () => ({}));
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
jest.mock("../services/duplicate.matching.js", () => ({
  findAuthorizedProfileMatch: jest.fn(),
}));

const {
  buildEffectiveFromMergeChoices,
} = require("../services/duplicate.merge.service.js");

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

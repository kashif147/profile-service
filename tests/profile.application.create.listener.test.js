jest.mock("../models/personal.details.model.js", () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

jest.mock("../models/professional.details.model.js", () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

jest.mock("../models/subscription.model.js", () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

jest.mock("../models/user.model.js", () => ({
  findOne: jest.fn(),
}));

jest.mock("../services/duplicate.detection.service.js", () => ({
  queueDuplicateDetection: jest.fn(),
}));

const PersonalDetails = require("../models/personal.details.model.js");
const ProfessionalDetails = require("../models/professional.details.model.js");
const SubscriptionDetails = require("../models/subscription.model.js");
const User = require("../models/user.model.js");
const profileApplicationCreateListener = require("../rabbitMQ/listeners/profile.application.create.listerner.js");

function mockLean(value) {
  return {
    lean: jest.fn().mockResolvedValue(value),
  };
}

describe("profile application create listener", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    User.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
  });

  test("propagates event tenantId into all profile application detail upserts", async () => {
    const userId = "507f1f77bcf86cd799439011";

    PersonalDetails.findOne.mockReturnValue(mockLean(null));
    PersonalDetails.findOneAndUpdate.mockResolvedValue({
      _id: "personal-1",
      userId,
      tenantId: "tenant-1",
      applicationId: "app-1",
    });
    ProfessionalDetails.findOne.mockReturnValue(mockLean(null));
    ProfessionalDetails.findOneAndUpdate.mockResolvedValue({
      _id: "professional-1",
      applicationId: "app-1",
    });
    SubscriptionDetails.findOne.mockResolvedValue(null);
    SubscriptionDetails.findOneAndUpdate.mockResolvedValue({
      _id: "subscription-1",
      applicationId: "app-1",
      subscriptionDetails: {
        paymentType: "Credit Card",
        paymentFrequency: "Annually",
      },
    });

    await profileApplicationCreateListener.handleProfileApplicationCreate({
      applicationId: "app-1",
      tenantId: "tenant-1",
      status: "submitted",
      personalDetails: {
        userId,
        applicationStatus: "submitted",
        personalInfo: {},
        contactInfo: {},
        meta: { userType: "PORTAL" },
      },
      professionalDetails: {
        userId,
        professionalDetails: {},
        meta: { userType: "PORTAL" },
      },
      subscriptionDetails: {
        userId,
        subscriptionDetails: {
          paymentType: "Credit Card",
        },
        meta: { userType: "PORTAL" },
      },
    });

    expect(PersonalDetails.findOneAndUpdate).toHaveBeenCalledWith(
      { applicationId: "app-1" },
      expect.objectContaining({
        tenantId: "tenant-1",
      }),
      expect.objectContaining({ upsert: true, runValidators: true }),
    );
    expect(ProfessionalDetails.findOneAndUpdate).toHaveBeenCalledWith(
      { applicationId: "app-1" },
      expect.objectContaining({
        tenantId: "tenant-1",
      }),
      expect.objectContaining({ upsert: true, runValidators: true }),
    );
    expect(SubscriptionDetails.findOneAndUpdate).toHaveBeenCalledWith(
      { applicationId: "app-1" },
      expect.objectContaining({
        $set: expect.objectContaining({
          tenantId: "tenant-1",
        }),
      }),
      expect.objectContaining({ upsert: true, runValidators: true }),
    );
  });
});

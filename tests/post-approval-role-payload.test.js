jest.mock("@projectShell/rabbitmq-middleware", () => ({
  publisher: {
    publish: jest.fn(),
  },
}));

jest.mock("../models/profile.model.js", () => ({
  findById: jest.fn(),
}));

jest.mock("../models/user.model.js", () => ({
  findOne: jest.fn(),
}));

jest.mock("../services/profile.audit.publisher.js", () => ({
  publishProfileAudit: jest.fn(),
}));

const { publisher } = require("@projectShell/rabbitmq-middleware");
const Profile = require("../models/profile.model.js");
const User = require("../models/user.model.js");
const {
  publishPostApprovalEvents,
} = require("../services/publishPostApprovalEvents.js");

describe("publishPostApprovalEvents", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    publisher.publish.mockResolvedValue({ success: true });
    Profile.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    User.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
  });

  it("includes linked portal user id and email in processed application event", async () => {
    await publishPostApprovalEvents({
      applicationId: "app-1",
      reviewerId: "crm-1",
      profileId: "profile-1",
      tenantId: "tenant-1",
      isExistingProfile: false,
      updatedProfile: { crmUserId: "crm-1", userId: null },
      linkedUserId: "portal-user-1",
      effective: {
        personalInfo: {},
        contactInfo: {
          personalEmail: "member@example.com",
        },
        professionalDetails: {},
        subscriptionDetails: {},
        subscriptionAttributes: {},
      },
      memberId: "M001",
      dateJoined: new Date("2026-06-18T12:00:00.000Z"),
      correlationId: "correlation-1",
    });

    expect(publisher.publish).toHaveBeenCalledWith(
      "applications.review.processed.v1",
      expect.objectContaining({
        applicationId: "app-1",
        userId: "portal-user-1",
        userEmail: "member@example.com",
      }),
      expect.objectContaining({
        exchange: "application.events",
        routingKey: "applications.review.processed.v1",
      }),
    );
  });

  it("publishes the portal user-service id when the profile stores a local synced user document id", async () => {
    User.findOne.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ userId: "portal-user-1" }),
      }),
    });

    await publishPostApprovalEvents({
      applicationId: "app-1",
      reviewerId: "crm-1",
      profileId: "profile-1",
      tenantId: "tenant-1",
      isExistingProfile: false,
      updatedProfile: { crmUserId: "crm-1", userId: "local-user-doc-1" },
      linkedUserId: null,
      effective: {
        personalInfo: {},
        contactInfo: {
          personalEmail: "member@example.com",
        },
        professionalDetails: {},
        subscriptionDetails: {},
        subscriptionAttributes: {},
      },
      memberId: "M001",
      dateJoined: new Date("2026-06-18T12:00:00.000Z"),
      correlationId: "correlation-1",
    });

    expect(User.findOne).toHaveBeenCalledWith({
      _id: "local-user-doc-1",
      tenantId: "tenant-1",
      userType: "PORTAL",
      isActive: true,
    });
    expect(publisher.publish).toHaveBeenCalledWith(
      "applications.review.processed.v1",
      expect.objectContaining({
        applicationId: "app-1",
        userId: "portal-user-1",
      }),
      expect.any(Object),
    );
  });
});

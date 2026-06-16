jest.mock("@projectShell/rabbitmq-middleware", () => ({
  publisher: {
    publish: jest.fn(),
  },
}));

jest.mock("../models/personal.details.model.js", () => ({
  findOne: jest.fn(),
  updateOne: jest.fn(),
}));

const PersonalDetails = require("../models/personal.details.model.js");
const { publisher } = require("@projectShell/rabbitmq-middleware");
const { APPLICATION_STATUS } = require("../constants/enums.js");
const ApplicationApprovalEventPublisher = require("../rabbitMQ/publishers/application.approval.publisher.js");
const {
  ONLY_PROCESSED_MESSAGE,
  recordExecutiveCouncilDecision,
} = require("../services/executiveCouncilApproval.service.js");

const session = {};

function mockFindOneResult(result) {
  PersonalDetails.findOne.mockReturnValue({
    session: jest.fn().mockReturnValue(result),
  });
}

describe("processed application status refactor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    publisher.publish.mockResolvedValue({ success: true });
    PersonalDetails.updateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  it("exposes processed as the operational terminal application status", () => {
    expect(APPLICATION_STATUS).toEqual({
      IN_PROGRESS: "in-progress",
      SUBMITTED: "submitted",
      PROCESSED: "processed",
      REJECTED: "rejected",
    });
    expect(APPLICATION_STATUS.APPROVED).toBeUndefined();
  });

  it("publishes application processed events with applicationStatus processed", async () => {
    await ApplicationApprovalEventPublisher.publishApplicationApproved({
      applicationId: "app-1",
      reviewerId: "user-1",
      profileId: "profile-1",
      applicationStatus: APPLICATION_STATUS.PROCESSED,
      tenantId: "tenant-1",
      effective: {
        personalInfo: {},
        contactInfo: {},
        professionalDetails: {},
        subscriptionDetails: {},
      },
      subscriptionAttributes: {},
    });

    expect(publisher.publish).toHaveBeenCalledWith(
      "applications.review.processed.v1",
      expect.objectContaining({
        applicationId: "app-1",
        applicationStatus: "processed",
      }),
      expect.objectContaining({
        exchange: "application.events",
        routingKey: "applications.review.processed.v1",
      }),
    );
  });

  it("records Executive Council approval without changing operational fields", async () => {
    mockFindOneResult({
      _id: "personal-1",
      applicationStatus: APPLICATION_STATUS.PROCESSED,
    });

    const result = await recordExecutiveCouncilDecision({
      applicationId: "app-1",
      tenantId: "tenant-1",
      reviewerId: "user-1",
      status: "approved",
      decisionDate: "2026-06-12",
      comments: "Approved at council",
      session,
    });

    expect(result.success).toBe(true);
    expect(PersonalDetails.updateOne).toHaveBeenCalledTimes(1);
    const update = PersonalDetails.updateOne.mock.calls[0][1];
    expect(Object.keys(update.$set).sort()).toEqual([
      "executiveCouncilApprovalDetails.approvedBy",
      "executiveCouncilApprovalDetails.comments",
      "executiveCouncilApprovalDetails.decisionDate",
      "executiveCouncilApprovalDetails.processedAt",
      "executiveCouncilApprovalDetails.status",
    ]);
    expect(update.$set).not.toHaveProperty("applicationStatus");
    expect(update.$set).not.toHaveProperty("approvalDetails");
  });

  it("blocks Executive Council approval unless the application is processed", async () => {
    mockFindOneResult({
      _id: "personal-1",
      applicationStatus: APPLICATION_STATUS.SUBMITTED,
    });

    const result = await recordExecutiveCouncilDecision({
      applicationId: "app-1",
      tenantId: "tenant-1",
      reviewerId: "user-1",
      status: "approved",
      session,
    });

    expect(result).toEqual({
      applicationId: "app-1",
      success: false,
      status: "skipped",
      error: ONLY_PROCESSED_MESSAGE,
    });
    expect(PersonalDetails.updateOne).not.toHaveBeenCalled();
  });
});

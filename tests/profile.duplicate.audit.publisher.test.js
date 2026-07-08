const mockPublish = jest.fn();

jest.mock("@projectShell/rabbitmq-middleware", () => ({
  publisher: {
    publish: mockPublish,
  },
}));

const {
  publishProfileDuplicateMergedAudit,
} = require("../services/profile.duplicate.audit.publisher.js");

describe("profile duplicate audit publisher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPublish.mockResolvedValue({ success: true });
  });

  test("summarizes merge choices for profile duplicate merge events", async () => {
    await publishProfileDuplicateMergedAudit({
      tenantId: "tenant-1",
      masterProfileId: "6a4d47f7c060a977a3b332ef",
      absorbedProfileId: "6a4d47f7c060a977a3b332ee",
      actorId: "reviewer-1",
      mergeFieldChoices: {
        "personalInfo.forename": "PROFILE",
      },
      beforeMaster: {},
      beforeAbsorbed: {},
      afterMaster: {},
    });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [, payload, options] = mockPublish.mock.calls[0];
    expect(payload.mergeFieldSelections).toEqual([
      expect.objectContaining({
        path: "personalInfo.forename",
        source: "PROFILE",
      }),
    ]);
    expect(options.metadata.mergeFieldCount).toBe(1);
  });
});

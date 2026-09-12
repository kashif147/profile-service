const mockFindOneAndUpdate = jest.fn();

jest.mock("../models/qualification.model.js", () => ({
  findOneAndUpdate: mockFindOneAndUpdate,
}));

const { handleCertificateIssued } = require("../rabbitMQ/listeners/certificateIssued.listener.js");

describe("handleCertificateIssued", () => {
  beforeEach(() => {
    mockFindOneAndUpdate.mockReset();
    mockFindOneAndUpdate.mockResolvedValue({});
  });

  it("upserts a Qualification keyed on tenantId/profileId/registrationId", async () => {
    await handleCertificateIssued({
      data: {
        tenantId: "tenant-1",
        profileId: "profile-1",
        registrationId: "registration-1",
        certificateId: "cert-1",
        eventId: "event-1",
        eventTitle: "CPD Training Day",
        certificationType: "Attendance",
        cpdCredits: 6,
        accreditationBody: "NMBI",
        issuedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { tenantId: "tenant-1", profileId: "profile-1", registrationId: "registration-1" },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          source: "event",
          eventId: "event-1",
          certificateId: "cert-1",
          title: "CPD Training Day",
          certificationType: "Attendance",
          cpdCredits: 6,
          accreditationBody: "NMBI",
        }),
      }),
      { upsert: true, new: true },
    );
  });

  it("tolerates a redelivered event without erroring (upsert is naturally idempotent)", async () => {
    const payload = {
      data: { tenantId: "tenant-1", profileId: "profile-1", registrationId: "registration-1" },
    };
    await handleCertificateIssued(payload);
    await handleCertificateIssued(payload);
    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it("skips a malformed payload without throwing", async () => {
    await expect(handleCertificateIssued({ data: { tenantId: "tenant-1" } })).resolves.toBeUndefined();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });
});

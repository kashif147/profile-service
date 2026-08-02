const mockFind = jest.fn();

jest.mock("../models/profile.model", () => ({
  find: mockFind,
}));

jest.mock("../models/group.model", () => {
  const model = jest.fn();
  model.MEMBERSHIP_MODES = ["STATIC", "DYNAMIC"];
  return model;
});

const groupService = require("../services/group.service");

function mockFindChain(result) {
  const chain = {
    select: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(result),
  };
  return chain;
}

describe("group.service resolveGroupMembers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("STATIC group resolves members by staticMemberIds against Profile", async () => {
    const memberId = "64b7f9f1f9f1f9f1f9f1f9f1";
    mockFind.mockReturnValue(
      mockFindChain([
        {
          _id: memberId,
          membershipNumber: "M-001",
          personalInfo: { forename: "Jane", surname: "Doe" },
          professionalDetails: { workLocation: "St. James's Hospital" },
          tenantId: "tenant-1",
        },
      ]),
    );

    const group = {
      tenantId: "tenant-1",
      membershipMode: "STATIC",
      staticMemberIds: [memberId, "not-a-valid-object-id"],
      criteria: {},
    };

    const result = await groupService.resolveGroupMembers(group);

    // Invalid ids are filtered out before querying; only the valid id is looked up.
    expect(mockFind).toHaveBeenCalledWith({
      _id: { $in: [memberId] },
      tenantId: "tenant-1",
    });
    expect(result.total).toBe(1);
    expect(result.members[0].membershipNumber).toBe("M-001");
    expect(result.members[0].personalInfo.fullName).toBe("Jane Doe");
    expect(result.unresolvedCriteria).toEqual([]);
  });

  test("STATIC group with no valid member ids returns empty without querying Profile", async () => {
    const group = {
      tenantId: "tenant-1",
      membershipMode: "STATIC",
      staticMemberIds: ["not-valid"],
      criteria: {},
    };

    const result = await groupService.resolveGroupMembers(group);

    expect(mockFind).not.toHaveBeenCalled();
    expect(result).toEqual({ members: [], total: 0, unresolvedCriteria: [] });
  });

  test("DYNAMIC group builds a live professionalDetails query from criteria and flags iroUserId as unresolved", async () => {
    mockFind.mockReturnValue(mockFindChain([]));

    const group = {
      tenantId: "tenant-1",
      membershipMode: "DYNAMIC",
      staticMemberIds: [],
      criteria: {
        workLocation: ["St. James's Hospital"],
        section: ["ICU"],
        grade: ["Staff Nurse"],
        branch: [],
        region: [],
        iroUserId: "user-99",
        membershipCategory: [],
      },
    };

    const result = await groupService.resolveGroupMembers(group);

    expect(mockFind).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      "professionalDetails.workLocation": { $in: ["St. James's Hospital"] },
      "professionalDetails.primarySection": { $in: ["ICU"] },
      "professionalDetails.grade": { $in: ["Staff Nurse"] },
    });
    expect(result.total).toBe(0);
    expect(result.members).toEqual([]);
    expect(result.unresolvedCriteria).toEqual(["iroUserId"]);
  });

  test("DYNAMIC group with empty criteria queries only by tenantId and has no unresolved criteria", async () => {
    mockFind.mockReturnValue(mockFindChain([]));

    const group = {
      tenantId: "tenant-1",
      membershipMode: "DYNAMIC",
      staticMemberIds: [],
      criteria: {},
    };

    const result = await groupService.resolveGroupMembers(group);

    expect(mockFind).toHaveBeenCalledWith({ tenantId: "tenant-1" });
    expect(result.unresolvedCriteria).toEqual([]);
  });
});

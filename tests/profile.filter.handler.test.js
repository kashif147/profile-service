const mockFind = jest.fn();
const mockCountDocuments = jest.fn();

jest.mock("../models/profile.model", () => ({
  find: mockFind,
  countDocuments: mockCountDocuments,
}));

const {
  getProfilesWithTemplateFilters,
} = require("../handlers/profile.filter.handler.js");

function mockFindChain(result) {
  const chain = {
    populate: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(result),
  };
  return chain;
}

describe("profile.filter.handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFind.mockReturnValue(mockFindChain([]));
    mockCountDocuments.mockResolvedValue(0);
  });

  test("always restricts profile summary results to active profiles", async () => {
    await getProfilesWithTemplateFilters("tenant-1", {}, 1, 500);

    expect(mockFind).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      isActive: { $ne: false },
    });
    expect(mockCountDocuments).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      isActive: { $ne: false },
    });
  });
});

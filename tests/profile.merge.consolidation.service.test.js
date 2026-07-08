const mockPersonalDetailsUpdateMany = jest.fn();
const mockMemberPaymentFormUpdateMany = jest.fn();
const mockTransferRequestUpdateMany = jest.fn();
const mockBatchUpdateMany = jest.fn();
const mockProfileUpdateMany = jest.fn();
const mockProfileUpdateOne = jest.fn();

jest.mock("../models/personal.details.model.js", () => ({
  updateMany: mockPersonalDetailsUpdateMany,
}));
jest.mock("../models/memberPaymentForm.model.js", () => ({
  MemberPaymentForm: {
    updateMany: mockMemberPaymentFormUpdateMany,
  },
}));
jest.mock("../models/transfer.request.model.js", () => ({
  updateMany: mockTransferRequestUpdateMany,
}));
jest.mock("../models/batch.model.js", () => ({
  updateMany: mockBatchUpdateMany,
}));
jest.mock("../models/profile.model.js", () => ({
  updateMany: mockProfileUpdateMany,
  updateOne: mockProfileUpdateOne,
}));
jest.mock("../services/subscription.service.client.js", () => ({
  reassignSubscriptionsForProfileMerge: jest.fn(),
}));
jest.mock("../services/account.service.client.js", () => ({
  reassignFinanceForProfileMerge: jest.fn(),
}));

const {
  reassignProfileServiceReferences,
} = require("../services/profile.merge.consolidation.service.js");

describe("profile merge consolidation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPersonalDetailsUpdateMany.mockResolvedValue({ modifiedCount: 1 });
    mockMemberPaymentFormUpdateMany.mockResolvedValue({ modifiedCount: 2 });
    mockTransferRequestUpdateMany.mockResolvedValue({ modifiedCount: 3 });
    mockBatchUpdateMany.mockResolvedValue({ modifiedCount: 4 });
    mockProfileUpdateMany.mockResolvedValue({ modifiedCount: 5 });
    mockProfileUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  test("reassigns member payment forms through the exported mongoose model", async () => {
    const tenantId = "tenant-1";
    const masterProfileId = "6a4d47f7c060a977a3b332ef";
    const absorbedProfileId = "6a4d47f7c060a977a3b332ee";

    const result = await reassignProfileServiceReferences({
      tenantId,
      masterProfileId,
      absorbedProfileId,
    });

    expect(mockMemberPaymentFormUpdateMany).toHaveBeenCalledWith(
      {
        tenantId,
        profileId: expect.objectContaining({ _bsontype: "ObjectId" }),
      },
      {
        $set: {
          profileId: expect.objectContaining({ _bsontype: "ObjectId" }),
        },
      },
      {},
    );
    expect(result.paymentFormsReassigned).toBe(2);
  });
});

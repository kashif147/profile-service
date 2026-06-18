jest.mock("../models/personal.details.model.js", () => ({
  findOne: jest.fn(),
}));
jest.mock("../models/profile.model.js", () => ({}));
jest.mock("../services/duplicate.detection.service.js", () => ({
  detectDuplicates: jest.fn(),
  findDuplicateMatches: jest.fn(),
}));
jest.mock("../services/profileLookup.service.js", () => ({
  findOrCreateProfileByEmail: jest.fn(),
  pickPrimaryEmail: jest.fn(),
  normalizeEmail: jest.fn((value) => String(value || "").toLowerCase()),
  findPortalUserByTenantEmail: jest.fn(),
  resolveLinkedPortalUserIdForProfile: jest.fn(),
}));
jest.mock("../helpers/profile.transform.js", () => ({
  flattenProfilePayload: jest.fn((value) => value || {}),
}));
jest.mock("../services/submission.service.js", () => ({
  loadSubmission: jest.fn(),
}));
jest.mock("../services/duplicate.merge.service.js", () => ({
  validateMergeFieldChoices: jest.fn(),
  resolveProfileForDuplicateMerge: jest.fn(),
  resolveMergedEffectiveForReview: jest.fn(),
  applyMergedEffectiveToApplication: jest.fn(),
}));
jest.mock("../services/duplicate.review.audit.publisher.js", () => ({
  publishDuplicateReviewDecidedAudit: jest.fn(),
}));

const PersonalDetails = require("../models/personal.details.model.js");
const {
  detectDuplicates,
} = require("../services/duplicate.detection.service.js");
const {
  publishDuplicateReviewDecidedAudit,
} = require("../services/duplicate.review.audit.publisher.js");
const {
  APPLICATION_STATUS,
  DUPLICATE_REVIEW_STATUS,
  DUPLICATE_REVIEW_ACTION,
} = require("../constants/enums.js");
const {
  APPLICATION_DUPLICATE_REVIEW_LOCKED_MESSAGE,
  getDuplicateReviewState,
  recordDuplicateDecision,
  runDuplicateDetection,
} = require("../services/duplicate.review.service.js");

const reviewerId = "507f1f77bcf86cd799439011";

function mockLeanPersonal(personal) {
  PersonalDetails.findOne.mockReturnValue({
    lean: jest.fn().mockResolvedValue(personal),
  });
}

describe("application duplicate review processed lock", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    detectDuplicates.mockResolvedValue({
      matchingApplications: [],
      matchingProfiles: [],
      matchSummary: [],
      hasPotentialDuplicate: false,
    });
    publishDuplicateReviewDecidedAudit.mockResolvedValue();
  });

  test("rejects duplicate detection writes after application processing", async () => {
    mockLeanPersonal({
      applicationId: "app-1",
      tenantId: "tenant-1",
      applicationStatus: APPLICATION_STATUS.PROCESSED,
      duplicateReview: {
        status: DUPLICATE_REVIEW_STATUS.MERGED,
        matchSummary: [],
      },
    });

    const promise = runDuplicateDetection("app-1", "tenant-1", reviewerId);

    await expect(promise).rejects.toThrow(
      APPLICATION_DUPLICATE_REVIEW_LOCKED_MESSAGE,
    );
    await expect(promise).rejects.toMatchObject({
      status: 422,
      code: "APPLICATION_DUPLICATE_REVIEW_LOCKED",
    });
    expect(detectDuplicates).not.toHaveBeenCalled();
  });

  test("returns processed duplicate drawer state without rerunning detection", async () => {
    mockLeanPersonal({
      applicationId: "app-1",
      tenantId: "tenant-1",
      applicationStatus: APPLICATION_STATUS.PROCESSED,
      duplicateReview: {
        status: DUPLICATE_REVIEW_STATUS.NOT_CHECKED,
        auditHistory: [
          {
            action: DUPLICATE_REVIEW_ACTION.MARKED_NEW,
            decisionReason: "Reviewed before processing",
          },
        ],
      },
    });

    const result = await getDuplicateReviewState("app-1", "tenant-1");

    expect(result).toMatchObject({
      applicationStatus: APPLICATION_STATUS.PROCESSED,
      isReadOnly: true,
      lockedMessage: APPLICATION_DUPLICATE_REVIEW_LOCKED_MESSAGE,
      duplicateReview: {
        status: DUPLICATE_REVIEW_STATUS.NOT_CHECKED,
        auditHistory: [
          expect.objectContaining({
            action: DUPLICATE_REVIEW_ACTION.MARKED_NEW,
          }),
        ],
      },
    });
    expect(result.matchingApplications).toEqual([]);
    expect(result.matchingProfiles).toEqual([]);
    expect(detectDuplicates).not.toHaveBeenCalled();
  });

  test("rejects duplicate decisions after application processing", async () => {
    PersonalDetails.findOne.mockResolvedValue({
      applicationId: "app-1",
      tenantId: "tenant-1",
      applicationStatus: APPLICATION_STATUS.PROCESSED,
      duplicateReview: {
        status: DUPLICATE_REVIEW_STATUS.POTENTIAL_MATCH,
        matchSummary: [],
      },
      save: jest.fn(),
    });

    const promise = recordDuplicateDecision({
      applicationId: "app-1",
      tenantId: "tenant-1",
      reviewerId,
      action: DUPLICATE_REVIEW_ACTION.MARKED_NEW,
    });

    await expect(promise).rejects.toThrow(
      APPLICATION_DUPLICATE_REVIEW_LOCKED_MESSAGE,
    );
    await expect(promise).rejects.toMatchObject({
      status: 422,
      code: "APPLICATION_DUPLICATE_REVIEW_LOCKED",
    });
  });

  test("allows unprocessed applications to resolve duplicate decisions", async () => {
    const save = jest.fn().mockResolvedValue();
    const personal = {
      applicationId: "app-1",
      tenantId: "tenant-1",
      applicationStatus: APPLICATION_STATUS.SUBMITTED,
      duplicateReview: {
        status: DUPLICATE_REVIEW_STATUS.POTENTIAL_MATCH,
        matchSummary: [
          {
            sourceType: "APPLICATION",
            sourceId: "app-2",
            score: 90,
            matchedFields: ["email"],
            ignored: false,
          },
        ],
      },
      duplicateDetection: {
        isPotentialDuplicate: true,
      },
      save,
    };
    PersonalDetails.findOne.mockResolvedValue(personal);

    const result = await recordDuplicateDecision({
      applicationId: "app-1",
      tenantId: "tenant-1",
      reviewerId,
      action: DUPLICATE_REVIEW_ACTION.IGNORE_MATCH,
      sourceType: "APPLICATION",
      sourceId: "app-2",
      decisionReason: "False positive",
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      duplicateReview: {
        status: DUPLICATE_REVIEW_STATUS.IGNORED,
        decisionReason: "False positive",
      },
      hasPotentialDuplicate: false,
    });
    expect(publishDuplicateReviewDecidedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: DUPLICATE_REVIEW_ACTION.IGNORE_MATCH,
        applicationId: "app-1",
      }),
    );
  });
});

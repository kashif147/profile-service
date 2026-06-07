const {
  isDuplicateReviewBlockingApproval,
  APPROVAL_ALLOWED_STATUSES,
  DUPLICATE_REVIEW_REQUIRED_MESSAGE,
} = require("../services/duplicate.review.helpers.js");
const { DUPLICATE_REVIEW_STATUS } = require("../constants/enums.js");

describe("duplicate.review approval gating", () => {
  test("blocks approval for unchecked and potential match statuses", () => {
    expect(
      isDuplicateReviewBlockingApproval(DUPLICATE_REVIEW_STATUS.NOT_CHECKED),
    ).toBe(true);
    expect(
      isDuplicateReviewBlockingApproval(DUPLICATE_REVIEW_STATUS.POTENTIAL_MATCH),
    ).toBe(true);
  });

  test("allows approval after explicit duplicate review decisions", () => {
    [
      DUPLICATE_REVIEW_STATUS.NO_MATCH,
      DUPLICATE_REVIEW_STATUS.LINKED,
      DUPLICATE_REVIEW_STATUS.MERGED,
      DUPLICATE_REVIEW_STATUS.MARKED_NEW,
      DUPLICATE_REVIEW_STATUS.IGNORED,
    ].forEach((status) => {
      expect(isDuplicateReviewBlockingApproval(status)).toBe(false);
      expect(APPROVAL_ALLOWED_STATUSES.has(status)).toBe(true);
    });
  });

  test("uses reviewer-facing message without Match-only wording", () => {
    expect(DUPLICATE_REVIEW_REQUIRED_MESSAGE).toContain("Create New Profile");
    expect(DUPLICATE_REVIEW_REQUIRED_MESSAGE).toContain("Ignore Match");
    expect(DUPLICATE_REVIEW_REQUIRED_MESSAGE).toContain("Tag this Profile");
    expect(DUPLICATE_REVIEW_REQUIRED_MESSAGE).toContain("Merge this Profile");
  });
});

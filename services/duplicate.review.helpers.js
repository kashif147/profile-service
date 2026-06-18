const { DUPLICATE_REVIEW_STATUS } = require("../constants/enums.js");

const APPROVAL_ALLOWED_STATUSES = new Set([
  DUPLICATE_REVIEW_STATUS.NO_MATCH,
  DUPLICATE_REVIEW_STATUS.LINKED,
  DUPLICATE_REVIEW_STATUS.MERGED,
  DUPLICATE_REVIEW_STATUS.MARKED_NEW,
  DUPLICATE_REVIEW_STATUS.IGNORED,
]);

const DUPLICATE_REVIEW_REQUIRED_MESSAGE =
  "Duplicate review is required before approval. Open Duplicate Profile Review and choose Create New Profile, Ignore Match, Tag this Profile, or Merge this Profile.";

const APPLICATION_DUPLICATE_REVIEW_LOCKED_MESSAGE =
  "This application has already been processed. Duplicate records can only be managed from the Profile section.";

function isDuplicateReviewBlockingApproval(status) {
  const normalized = status || DUPLICATE_REVIEW_STATUS.NOT_CHECKED;
  return !APPROVAL_ALLOWED_STATUSES.has(normalized);
}

module.exports = {
  APPROVAL_ALLOWED_STATUSES,
  APPLICATION_DUPLICATE_REVIEW_LOCKED_MESSAGE,
  DUPLICATE_REVIEW_REQUIRED_MESSAGE,
  isDuplicateReviewBlockingApproval,
};

const mongoose = require("mongoose");

function toObjectIdOrNull(value) {
  if (value == null || value === "" || value === "bypass-user") {
    return null;
  }
  const str = String(value).trim();
  if (!mongoose.Types.ObjectId.isValid(str)) {
    return null;
  }
  return new mongoose.Types.ObjectId(str);
}

function getReviewerIdForDb(reviewerId) {
  return toObjectIdOrNull(reviewerId);
}

module.exports = {
  toObjectIdOrNull,
  getReviewerIdForDb,
};

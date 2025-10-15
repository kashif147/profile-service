// constants.js
const APPLICATION_STATUS = {
  IN_PROGRESS: "IN_PROGRESS",
  SUBMITTED: "SUBMITTED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
};

const OVERLAY_STATUS = {
  OPEN: "open",
  DECIDED: "decided",
};

const OVERLAY_DECISION = {
  NONE: "none",
  APPROVED: "approved",
  REJECTED: "rejected",
};

module.exports = {
  APPLICATION_STATUS,
  OVERLAY_STATUS,
  OVERLAY_DECISION,
};

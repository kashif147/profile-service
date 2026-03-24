const {
  APPLICATION_REVIEW_EVENTS: APPROVED_EVENTS,
} = require("./application.review.approved.js");
const {
  APPLICATION_REVIEW_EVENTS: REJECTED_EVENTS,
} = require("./application.review.rejected.js");
const { MEMBERSHIP_EVENTS } = require("./member.created.requested.js");
const { BATCH_PROCESS_EVENTS } = require("./batch.process.js");

// Single export so APPLICATION_REVIEW_EVENTS.APPLICATION_REVIEW_REJECTED is defined
// (reject handlers were using APPLICATION_REVIEW_REJECTED on the approved-only object).
const APPLICATION_REVIEW_EVENTS = {
  ...APPROVED_EVENTS,
  ...REJECTED_EVENTS,
};

module.exports = {
  APPLICATION_REVIEW_EVENTS,
  APPLICATION_REVIEW_REJECTED_EVENTS: REJECTED_EVENTS,
  MEMBERSHIP_EVENTS,
  BATCH_PROCESS_EVENTS,
};

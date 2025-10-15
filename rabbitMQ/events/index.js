const {
  APPLICATION_REVIEW_EVENTS,
} = require("./application.review.approved.js");
const {
  APPLICATION_REVIEW_EVENTS: REJECTED_EVENTS,
} = require("./application.review.rejected.js");
const { MEMBERSHIP_EVENTS } = require("./member.created.requested.js");

module.exports = {
  APPLICATION_REVIEW_EVENTS,
  APPLICATION_REVIEW_REJECTED_EVENTS: REJECTED_EVENTS,
  MEMBERSHIP_EVENTS,
};

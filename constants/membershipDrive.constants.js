const DRIVE_STATUSES = ["DRAFT", "IN_PROGRESS", "COMPLETED", "INACTIVE"];

// Allowed status transitions. INACTIVE is the soft-delete state and is terminal.
const STATUS_TRANSITIONS = {
  DRAFT: ["IN_PROGRESS", "COMPLETED", "INACTIVE"],
  IN_PROGRESS: ["COMPLETED", "INACTIVE"],
  COMPLETED: ["INACTIVE"],
  INACTIVE: [],
};

// Statuses in which the drive's details may still be edited.
const EDITABLE_STATUSES = ["DRAFT", "IN_PROGRESS"];

// After a drive is COMPLETED its owner may still attribute applications (created within the
// drive's dates) for this many days - for paper forms processed after the drive closes.
const LATE_LINK_GRACE_DAYS = Number(process.env.MEMBERSHIP_DRIVE_LATE_LINK_GRACE_DAYS) || 7;

// subscriptionDetails.membershipStatus value the CRM/portal forms send for a rejoining member.
const REJOIN_MEMBERSHIP_STATUS = "rejoin";

module.exports = {
  DRIVE_STATUSES,
  STATUS_TRANSITIONS,
  EDITABLE_STATUSES,
  LATE_LINK_GRACE_DAYS,
  REJOIN_MEMBERSHIP_STATUS,
};

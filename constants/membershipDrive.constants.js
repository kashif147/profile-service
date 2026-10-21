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

// Registrations can only be linked to a drive that is running.
const LINKABLE_STATUSES = ["IN_PROGRESS"];

// subscriptionDetails.membershipStatus value the CRM/portal forms send for a rejoining member.
const REJOIN_MEMBERSHIP_STATUS = "rejoin";

module.exports = {
  DRIVE_STATUSES,
  STATUS_TRANSITIONS,
  EDITABLE_STATUSES,
  LINKABLE_STATUSES,
  REJOIN_MEMBERSHIP_STATUS,
};

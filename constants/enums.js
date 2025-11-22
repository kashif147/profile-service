// Application Status Enums
exports.APPLICATION_STATUS = {
  IN_PROGRESS: "in-progress",
  SUBMITTED: "submitted",
  APPROVED: "approved",
  REJECTED: "rejected",
};

// Preferred Address Enums
exports.PREFERRED_ADDRESS = {
  HOME: "home",
  WORK: "work",
};

// User Type Enums
exports.USER_TYPE = {
  CRM: "CRM",
  PORTAL: "PORTAL",
};

// Preferred Email Enums
exports.PREFERRED_EMAIL = {
  PERSONAL: "personal",
  WORK: "work",
};

// Payment Type Enums
// NOTE: Must match portal-service enum values for compatibility
exports.PAYMENT_TYPE = {
  PAYROLL_DEDUCTION: "Salary Deduction", // Matches portal-service
  DIRECT_DEBIT: "Direct Debit",
  CARD_PAYMENT: "Credit Card", // Matches portal-service
  SBO_PAYMENT: "Standing Bank Order",
};

// Payment Frequency Enums
exports.PAYMENT_FREQUENCY = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUALLY: "Annually",
};

exports.MEMBERSHIP_STATUS = {
  ACTIVE: "Active",
  RESIGNED: "Resigned",
  CANCELLED: "Cancelled",
  SUSPENDED: "Suspended",
  ARCHIVED: "Archived",
};

// Overlay Status Enums
exports.OVERLAY_STATUS = {
  OPEN: "open",
  DECIDED: "decided",
};

// Overlay Decision Enums
exports.OVERLAY_DECISION = {
  NONE: "none",
  APPROVED: "approved",
  REJECTED: "rejected",
};

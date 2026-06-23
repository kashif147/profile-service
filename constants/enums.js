// Application Status Enums
exports.APPLICATION_STATUS = {
  IN_PROGRESS: "in-progress",
  SUBMITTED: "submitted",
  PROCESSED: "processed",
  REJECTED: "rejected",
};

exports.DUPLICATE_REVIEW_STATUS = {
  NOT_CHECKED: "NOT_CHECKED",
  NO_MATCH: "NO_MATCH",
  POTENTIAL_MATCH: "POTENTIAL_MATCH",
  LINKED: "LINKED",
  MERGED: "MERGED",
  MARKED_NEW: "MARKED_NEW",
  IGNORED: "IGNORED",
};

exports.DUPLICATE_REVIEW_ACTION = {
  LINK: "LINK",
  MERGE: "MERGE",
  MARKED_NEW: "MARKED_NEW",
  IGNORE_MATCH: "IGNORE_MATCH",
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
  SBO_PAYMENT: "Standing Order",
  CHEQUE: "Cheque",
  CASH: "Cash",
};

// Payment Frequency Enums
exports.PAYMENT_FREQUENCY = {
  WEEKLY: "Weekly",
  FORTNIGHTLY: "Fortnightly",
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
  LAPSED: "Lapsed",
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

// Template filter operators (for application filter templates)
exports.FILTER_OPERATOR = {
  EQUAL_TO: "equal_to",
  NOT_EQUAL_TO: "not_equal_to",
  BETWEEN: "between",
  WITHIN: "within",
  MORE_THAN: "more_than",
};

// Allowed filter field names for application templates (camelCase as sent by frontend)
exports.TEMPLATE_FILTER_KEYS = {
  APPLICATION_STATUS: "applicationStatus",
  MEMBERSHIP_CATEGORY: "membershipCategory",
  GRADE: "grade",
};

/**
 * Map from frontend camelCase filter name to backend source and DB path.
 * Frontend sends e.g. workLocation; we resolve to the collection and path.
 * source: "personalDetails" = field on PersonalDetails (main query); "professionalDetails" | "subscriptionDetails" = resolve applicationIds then filter.
 */
exports.FILTER_FIELD_MAP = {
  applicationStatus: { source: "personalDetails", path: "applicationStatus" },
  "executiveCouncilApprovalDetails.status": {
    source: "personalDetails",
    path: "executiveCouncilApprovalDetails.status",
  },
  "executiveCouncilApprovalDetails.decisionDate": {
    source: "personalDetails",
    path: "executiveCouncilApprovalDetails.decisionDate",
    valueType: "date",
  },
  membershipCategory: {
    source: "both",
    pathSubs: "subscriptionDetails.membershipCategory",
    pathProf: "professionalDetails.membershipCategory",
  },
  workLocation: {
    source: "professionalDetails",
    path: "professionalDetails.workLocation",
  },
  grade: { source: "professionalDetails", path: "professionalDetails.grade" },
  branch: { source: "professionalDetails", path: "professionalDetails.branch" },
  region: { source: "professionalDetails", path: "professionalDetails.region" },
  submissionDate: {
    source: "subscriptionDetails",
    path: "subscriptionDetails.submissionDate",
    valueType: "date",
  },
  joinDate: {
    source: "subscriptionDetails",
    path: "subscriptionDetails.dateJoined",
    valueType: "date",
  },
  primarySection: {
    source: "subscriptionDetails",
    path: "subscriptionDetails.primarySection",
  },
  paymentType: {
    source: "subscriptionDetails",
    path: "subscriptionDetails.paymentType",
  },
  payrollNo: {
    source: "subscriptionDetails",
    path: "subscriptionDetails.payrollNo",
  },
  mobileNumber: { source: "personalDetails", path: "contactInfo.mobileNumber" },
  preferredEmail: {
    source: "personalDetails",
    path: "contactInfo.preferredEmail",
  },
  personalEmail: {
    source: "personalDetails",
    path: "contactInfo.personalEmail",
  },
  workEmail: { source: "personalDetails", path: "contactInfo.workEmail" },
};

/** All camelCase filter keys the frontend may send (for validation). */
exports.ALLOWED_FILTER_KEYS = Object.keys(exports.FILTER_FIELD_MAP);

/**
 * Profile document paths for CRM profile list filter templates (templateType "profile").
 * Keys are camelCase filter names; values are Mongo paths on Profile.
 */
exports.PROFILE_FILTER_FIELD_MAP = {
  workLocation: "professionalDetails.workLocation",
  grade: "professionalDetails.grade",
  branch: "professionalDetails.branch",
  region: "professionalDetails.region",
  primarySection: "professionalDetails.primarySection",
  secondarySection: "professionalDetails.secondarySection",
  payrollNo: "professionalDetails.payrollNo",
  mobileNumber: "contactInfo.mobileNumber",
  preferredEmail: "contactInfo.preferredEmail",
  personalEmail: "contactInfo.personalEmail",
  workEmail: "contactInfo.workEmail",
  isActive: "isActive",
  membershipStatus: "additionalInformation.membershipStatus",
  submissionDate: "submissionDate",
};

exports.PROFILE_TEMPLATE_FILTER_KEYS = Object.keys(
  exports.PROFILE_FILTER_FIELD_MAP,
);

/** Credit notes list filter keys (templateType creditnotes). */
exports.CREDIT_NOTE_FILTER_FIELD_MAP = {
  status: "status",
  memberId: "memberId",
  docNo: "docNo",
  invoiceDocNo: "invoiceDocNo",
  effectiveDate: "effectiveDate",
  createdAt: "createdAt",
};

exports.CREDIT_NOTE_TEMPLATE_FILTER_KEYS = Object.keys(
  exports.CREDIT_NOTE_FILTER_FIELD_MAP,
);

/** Membership listing report (templateType membershiplisting) — reporting-service listing API keys. */
exports.MEMBERSHIP_LISTING_TEMPLATE_FILTER_FIELD_MAP = {
  membershipCategories: "membershipCategories",
  membershipStatuses: "membershipStatuses",
  membershipMovements: "membershipMovements",
  grades: "grades",
  sections: "sections",
  regions: "regions",
  branches: "branches",
  workLocations: "workLocations",
  paymentTypes: "paymentTypes",
  paymentFrequencies: "paymentFrequencies",
  subscriptionYears: "subscriptionYears",
  isCurrent: "isCurrent",
  startDateRange: "startDateRange",
  expiryDateRange: "expiryDateRange",
  cancelledDateRange: "cancelledDateRange",
  resignedDateRange: "resignedDateRange",
  processedDateRange: "processedDateRange",
  search: "search",
};

exports.MEMBERSHIP_LISTING_TEMPLATE_FILTER_KEYS = Object.keys(
  exports.MEMBERSHIP_LISTING_TEMPLATE_FILTER_FIELD_MAP,
);

// All columns that can be returned in application list response (template columns). User sends camelCase. Empty array = all columns.
exports.APPLICATION_RESPONSE_COLUMNS = [
  "applicationId",
  "userId",
  "membershipNumber",
  "membershipCategory",
  "applicationStatus",
  "createdAt",
  "updatedAt",
  "submissionDate",
  "joinDate",
  "executiveCouncilApprovalDetails",
  "executiveCouncilApprovalDetails.status",
  "executiveCouncilApprovalDetails.decisionDate",
  "executiveCouncilApprovalDetails.approvedBy",
  "personalDetails.applicationStatus",
  "personalDetails.personalInfo.title",
  "personalDetails.personalInfo.forename",
  "personalDetails.personalInfo.surname",
  "personalDetails.personalInfo.fullName",
  "personalDetails.personalInfo.gender",
  "personalDetails.personalInfo.dateOfBirth",
  "personalDetails.personalInfo.countryPrimaryQualification",
  "personalDetails.contactInfo.preferredAddress",
  "personalDetails.contactInfo.eircode",
  "personalDetails.contactInfo.buildingOrHouse",
  "personalDetails.contactInfo.streetOrRoad",
  "personalDetails.contactInfo.areaOrTown",
  "personalDetails.contactInfo.countyCityOrPostCode",
  "personalDetails.contactInfo.country",
  "personalDetails.contactInfo.mobileNumber",
  "personalDetails.contactInfo.telephoneNumber",
  "personalDetails.contactInfo.personalEmail",
  "personalDetails.contactInfo.workEmail",
  "personalDetails.contactInfo.consent",
  "approvalDetails.approvedBy",
  "approvalDetails.approvedAt",
  "personalDetails",
  "professionalDetails",
  "subscriptionDetails",
  "approvalDetails",
];

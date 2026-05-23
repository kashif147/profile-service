const mongoose = require("mongoose");

const PAYMENT_FORM_TYPES = [
  "STANDING_ORDER",
  "SALARY_DEDUCTION",
  "DD_MANDATE",
];

const PAYMENT_FORM_STATUSES = [
  "draft",
  "generated",
  "submitted",
  "verified",
  "active",
  "rejected",
  "superseded",
];

const EncryptedStringSchema = {
  value: { type: String, default: null },
  encrypted: { type: Boolean, default: false },
};

const AuditEntrySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    action: { type: String, trim: true },
    actorId: { type: String, default: null },
    actorType: { type: String, enum: ["PORTAL", "CRM", "SYSTEM"], default: "CRM" },
    clientIp: { type: String, default: null },
    channel: { type: String, default: null },
  },
  { _id: false }
);

const MemberPaymentFormSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Profile",
      required: true,
      index: true,
    },
    membershipNumber: { type: String, required: true, index: true },
    subscriptionId: { type: String, default: null },
    userId: { type: String, default: null, index: true },
    formType: {
      type: String,
      enum: PAYMENT_FORM_TYPES,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: PAYMENT_FORM_STATUSES,
      default: "draft",
      index: true,
    },
    source: {
      type: String,
      enum: ["portal", "mobile", "crm", "notification", "post", "email"],
      default: "crm",
    },
    brandingSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    organisationSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    standingOrder: {
      beneficiaryAccountName: String,
      beneficiaryBankName: String,
      beneficiaryAddress: String,
      beneficiaryBic: String,
      beneficiaryIban: { type: String, default: null },
      beneficiaryReference: String,
      paymentFrequency: String,
      frequencyLayoutKey: String,
      installmentAmountEur: Number,
      installmentAmountDisplay: String,
      debtorBankName: String,
      debtorBankAddress: String,
      debtorAccountName: String,
      debtorIban: EncryptedStringSchema,
      debtorBic: EncryptedStringSchema,
      startDate: Date,
      signatureDates: [Date],
      signatureBlobPaths: [String],
    },
    salaryDeduction: {
      memberFullName: String,
      employedAt: String,
      referenceMembershipNo: String,
      payrollStaffNo: String,
      installmentAmountEur: Number,
      installmentAmountDisplay: String,
      commencingDate: Date,
      signedDate: Date,
      signatureBlobPath: String,
    },
    directDebitMandate: {
      creditorName: String,
      creditorIdentifier: String,
      creditorAddress: String,
      creditorCity: String,
      creditorPostcode: String,
      creditorCountry: String,
      uniqueMandateReference: String,
      paymentTypeRecurrent: { type: Boolean, default: true },
      debtorName: String,
      debtorAddress: String,
      debtorCity: String,
      debtorPostcode: String,
      debtorCountry: String,
      debtorIban: EncryptedStringSchema,
      debtorBic: EncryptedStringSchema,
      signedDate: Date,
      signatureBlobPaths: [String],
      isAuthorized: { type: Boolean, default: false },
    },
    generatedPdf: {
      blobPath: String,
      fileName: String,
      contentType: String,
    },
    signedPdf: {
      blobPath: String,
      fileName: String,
      contentType: String,
    },
    paperUpload: {
      blobPath: String,
      fileName: String,
      contentType: String,
      uploadedAt: Date,
      uploadedBy: String,
    },
    emailOptions: {
      sendTo: String,
      subject: String,
      body: String,
      attachPdf: { type: Boolean, default: true },
      sentAt: Date,
      sentBy: String,
      lastError: String,
    },
    submissionAudit: {
      submittedAt: Date,
      submittedByUserId: String,
      submittedByUserType: String,
      clientIp: String,
      ipSource: String,
      userAgent: String,
      channel: String,
    },
    approvalAudit: {
      approvedAt: Date,
      approvedByUserId: String,
      clientIp: String,
    },
    auditTrail: [AuditEntrySchema],
    gdpr: {
      lawfulBasis: { type: String, default: "contract" },
      privacyNoticeVersion: String,
      consentCapturedAt: Date,
      retentionUntil: Date,
    },
    visibility: {
      portalVisible: { type: Boolean, default: false },
      portalVisibleFrom: Date,
    },
    notification: {
      approvalNotificationSentAt: Date,
    },
    meta: {
      createdBy: String,
      updatedBy: String,
    },
  },
  { timestamps: true }
);

MemberPaymentFormSchema.index({ tenantId: 1, status: 1, formType: 1 });
MemberPaymentFormSchema.index({ tenantId: 1, membershipNumber: 1 });

module.exports = {
  MemberPaymentForm: mongoose.model("MemberPaymentForm", MemberPaymentFormSchema),
  PAYMENT_FORM_TYPES,
  PAYMENT_FORM_STATUSES,
};

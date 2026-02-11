const mongoose = require("mongoose");

// Batch detail types: check, deduction (extensible - add more in enum as needed)
const BATCH_DETAIL_TYPES = ["cheque", "deduction", "other"];

const BatchDetailSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: false,
      index: true,
    },
    type: {
      type: String,
      enum: BATCH_DETAIL_TYPES,
      required: true,
      index: true,
    },
    batchDate: {
      type: Date,
      required: true,
      index: true,
    },
    paymentDate: {
      type: Date,
      required: true,
    },
    workLocation: {
      type: String,
      trim: true,
      default: null,
    },
    bank: {
      type: String,
      trim: true,
      default: null,
    },
    batchStatus: {
      type: String,
      trim: true,
      default: "pending",
    },
    referenceNumber: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },
    comments: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },
    // File stored in Azure Blob Storage (no expiration). URL stored for download/view.
    fileBlobPath: { type: String, default: null, trim: true },
    fileUrl: { type: String, default: null, trim: true }, // Full blob URL (no SAS, no expiration)
    fileName: { type: String, default: null, trim: true, maxlength: 500 },
    fileContentType: { type: String, default: null, trim: true },
    // Populated when process API is run: members found in system (profile snapshot + value from file)
    batchPayments: [
      {
        profileId: { type: mongoose.Schema.Types.ObjectId, ref: "Profile", required: true },
        membershipNumber: { type: String, required: true, trim: true },
        valueForPeriodSelected: { type: Number, default: null },
        rowIndex: { type: Number, default: null },
        // From Profile: personalInfo
        forename: { type: String, default: null, trim: true },
        surname: { type: String, default: null, trim: true },
        dateOfBirth: { type: Date, default: null },
        gender: { type: String, default: null, trim: true },
        // From Profile: contactInfo
        personalEmail: { type: String, default: null, trim: true },
        workEmail: { type: String, default: null, trim: true },
        mobileNumber: { type: String, default: null, trim: true },
        fullAddress: { type: String, default: null, trim: true },
        // From Profile: professionalDetails
        workLocation: { type: String, default: null, trim: true },
        grade: { type: String, default: null, trim: true },
        primarySection: { type: String, default: null, trim: true },
        // From Profile: preferences
        valueAddedServices: { type: Boolean, default: false },
        // All fields extracted from the file row (same shape as batchExceptions)
        fileRow: {
          membershipNumber: { type: String, default: null, trim: true },
          lastName: { type: String, default: null, trim: true },
          firstName: { type: String, default: null, trim: true },
          fullName: { type: String, default: null, trim: true },
          valueForPeriodSelected: { type: Number, default: null },
          rowIndex: { type: Number, default: null },
        },
      },
    ],
    // Populated when process API is run: members NOT found OR matched but value null/0 (fields from file only)
    batchExceptions: [
      {
        profileId: { type: mongoose.Schema.Types.ObjectId, ref: "Profile", required: false },
        membershipNumber: { type: String, required: true, trim: true },
        lastName: { type: String, default: null, trim: true },
        firstName: { type: String, default: null, trim: true },
        fullName: { type: String, default: null, trim: true },
        valueForPeriodSelected: { type: Number, default: null },
        rowIndex: { type: Number, default: null },
      },
    ],
    createdBy: {
      type: String,
      required: true,
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: "batchdetails",
  }
);

BatchDetailSchema.index({ tenantId: 1, isDeleted: 1 });
BatchDetailSchema.index({ type: 1, batchDate: -1 });

module.exports = mongoose.model("BatchDetail", BatchDetailSchema);
module.exports.BATCH_DETAIL_TYPES = BATCH_DETAIL_TYPES;

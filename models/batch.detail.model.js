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
    date: {
      type: Date,
      required: true,
      index: true,
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
    // File stored in Azure Blob Storage
    fileBlobPath: {
      type: String,
      default: null,
      trim: true,
    },
    fileName: {
      type: String,
      default: null,
      trim: true,
      maxlength: 500,
    },
    fileContentType: {
      type: String,
      default: null,
      trim: true,
    },
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
BatchDetailSchema.index({ type: 1, date: -1 });

module.exports = mongoose.model("BatchDetail", BatchDetailSchema);
module.exports.BATCH_DETAIL_TYPES = BATCH_DETAIL_TYPES;

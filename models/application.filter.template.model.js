const mongoose = require("mongoose");
const { APPLICATION_STATUS } = require("../constants/enums");

const ApplicationFilterTemplateSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    }, // CRM user who created this template
    filters: {
      type: {
        type: mongoose.Schema.Types.Mixed, // Can be string or array of strings
        required: false,
      },
    },
    columns: {
      type: [String], // Array of field names to include in the response
      default: [],
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    meta: {
      deleted: {
        type: Boolean,
        default: false,
      },
      deletedAt: {
        type: Date,
        default: null,
      },
    },
  },
  { timestamps: true }
);

// Index for efficient queries
ApplicationFilterTemplateSchema.index({ userId: 1, "meta.deleted": 1 });
ApplicationFilterTemplateSchema.index({ userId: 1, isDefault: 1 });

module.exports = mongoose.model(
  "ApplicationFilterTemplate",
  ApplicationFilterTemplateSchema
);


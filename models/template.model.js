const mongoose = require("mongoose");
const { APPLICATION_STATUS } = require("../constants/enums");

const TemplateSchema = new mongoose.Schema(
  {
    templateType: {
      type: String,
      default: "application",
      trim: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, 
      index: true,
    }, 
    filters: {
      type: {
        type: mongoose.Schema.Types.Mixed, 
        required: false,
      },
    },
    columns: {
      type: [String], 
      default: [],
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    systemDefault: {
      type: Boolean,
      default: false,
      index: true,
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
TemplateSchema.index({ userId: 1, "meta.deleted": 1 });
TemplateSchema.index({ userId: 1, isDefault: 1 });
TemplateSchema.index({ systemDefault: 1, "meta.deleted": 1 });

module.exports = mongoose.model("Template", TemplateSchema);

const mongoose = require("mongoose");

const ProfessionalSchema = new mongoose.Schema(
  {
    applicationId: { type: String, required: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: false,
      default: null,
    }, // Azure B2C ID
    professionalDetails: {
      // isRetired: { type: Boolean, default: false },
      retiredDate: { type: Date, allowNull: true },
      pensionNo: { type: String, allowNull: true },
      studyLocation: { type: String, allowNull: true },
      startDate: { type: Date, allowNull: true },
      graduationDate: { type: Date, allowNull: true },
      discipline: { type: String, allowNull: true },
      workLocation: { type: String, allowNull: true },
      otherWorkLocation: { type: String, allowNull: true },
      branch: { type: String, allowNull: true },
      region: { type: String, allowNull: true },
      grade: { type: String, allowNull: true },
      otherGrade: { type: String, allowNull: true },
      nursingAdaptationProgramme: { type: Boolean, default: false },
      nmbiNumber: { type: String, allowNull: true },
      nurseType: { type: String, allowNull: true },
    },

    meta: {
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "users" },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "users" },
      userType: { type: String },
    },
    deleted: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Index for frequently queried field
ProfessionalSchema.index({ applicationId: 1 });

module.exports = mongoose.model("ProfessionalDetails", ProfessionalSchema);

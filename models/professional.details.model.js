const mongoose = require("mongoose");

const ProfessionalSchema = new mongoose.Schema(
  {
    ApplicationId: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "users", required: false, default: null }, // Azure B2C ID
    professionalDetails: {
      membershipCategory: { type: String, allowNull: true },
      workLocation: { type: String, allowNull: true },
      otherWorkLocation: { type: String, allowNull: true },
      grade: { type: String, allowNull: true },
      otherGrade: { type: String, allowNull: true },
      nmbiNumber: { type: String, allowNull: true },
      nurseType: { type: String, allowNull: true },
      nursingAdaptationProgramme: { type: Boolean, default: false },
      region: { type: String, allowNull: true },
      branch: { type: String, allowNull: true },
      pensionNo: { type: String, allowNull: true },
      isRetired: { type: Boolean, default: false },
      retiredDate: { type: Date, allowNull: true },
      studyLocation: { type: String, allowNull: true },
      graduationDate: { type: Date, allowNull: true },
    },

    meta: {
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "users" },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "users" },
      userType: { type: String },
      deleted: { type: Boolean, default: false },
      isActive: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProfessionalDetails", ProfessionalSchema);

// models/professional.model.js
const mongoose = require("mongoose");

const ProfessionalSchema = new mongoose.Schema(
  {
    ApplicationId: { type: String, required: true, index: true },
    tenantId: { type: String, index: true },
    professionalDetails: {
      qualifications: [String],
      specializations: [String],
      yearsOfExperience: Number,
      currentPosition: String,
      employer: String,
      department: String,
      registrationNumber: String,
      professionalBody: String,
      membershipCategory: String,
      membershipStatus: {
        type: String,
        enum: ["ACTIVE", "INACTIVE", "SUSPENDED", "TERMINATED"],
        default: "ACTIVE",
      },
    },
    status: {
      type: String,
      enum: ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"],
      default: "DRAFT",
    },
  },
  { timestamps: true, versionKey: "professionalVersion" }
);

ProfessionalSchema.index({ ApplicationId: 1, tenantId: 1 });
module.exports = mongoose.model("Professional", ProfessionalSchema);

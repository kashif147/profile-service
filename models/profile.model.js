const mongoose = require("mongoose");
const ProfileSchema = new mongoose.Schema(
  {
    tenantId: { type: String, index: true },
    email: { type: String, required: true },
    normalizedEmail: { type: String, required: true },
    mobileNumber: String,
    surname: String,
    forename: String,
    dateOfBirth: Date,
    addressLine1: String,
    personalInfo: Object,
    contactInfo: Object,
    professionalDetails: Object,
    subscriptionAttributes: {
      payrollNo: String,
      otherIrishTradeUnion: { type: Boolean, default: false },
      otherScheme: { type: Boolean, default: false },
      recuritedBy: String,
      recuritedByMembershipNo: String,
      primarySection: String,
      otherPrimarySection: String,
      secondarySection: String,
      otherSecondarySection: String,
      incomeProtectionScheme: { type: Boolean, default: false },
      inmoRewards: { type: Boolean, default: false },
      valueAddedServices: { type: Boolean, default: false },
      termsAndConditions: { type: Boolean, default: true },
    },
    applicationStatus: {
      type: String,
      enum: ["IN_PROGRESS", "SUBMITTED", "APPROVED", "REJECTED"],
      default: "SUBMITTED",
      index: true,
    },
    approvalDetails: {
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "users" },
      approvedAt: Date,
      rejectionReason: String,
      comments: String,
      effectiveHash: String,
      effectiveSnapshot: Object,
    },
  },
  { timestamps: true, versionKey: "profileVersion" }
);
ProfileSchema.index({ tenantId: 1, normalizedEmail: 1 }, { unique: true });
module.exports = mongoose.model("Profile", ProfileSchema);

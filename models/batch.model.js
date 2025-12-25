const mongoose = require("mongoose");

const BatchSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    type: {
      type: String,
      enum: ["new", "graduate", "recruitAFriend"],
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    profileIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Profile",
        required: true,
      },
    ],
    profiles: [
      {
        // Reference to original profile
        profileId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Profile",
          required: true,
        },
        // Fields from "new" format
        membershipNo: { type: String, default: null },
        fullName: { type: String, default: null },
        addressLine1: { type: String, default: null },
        addressLine2: { type: String, default: null },
        addressLine3: { type: String, default: null },
        addressCity: { type: String, default: null },
        addressCounty: { type: String, default: null },
        addressPostcode: { type: String, default: null },
        email: { type: String, default: null },
        mobileNumber: { type: String, default: null },
        newMember: { type: Boolean, default: false },
        reward: { type: Boolean, default: false },
        // Fields from "graduate" format
        membershipNumber: { type: String, default: null },
        dateJoined: { type: Date, default: null },
        dateApplicationProcessed: { type: Date, default: null },
        unionConsent: { type: Boolean, default: false },
        exclusiveDiscountsAndOffers: { type: Boolean, default: false },
        cornmarketMarketingOptIn: { type: Boolean, default: false },
        workplace: { type: String, default: null },
        payrollNumber: { type: String, default: null },
        grade: { type: String, default: null },
        gender: { type: String, default: null },
        surname: { type: String, default: null },
        forenames: { type: String, default: null },
        telephoneMobile: { type: String, default: null },
        emailAddress: { type: String, default: null },
        address: { type: String, default: null },
        addr2: { type: String, default: null },
        addr3: { type: String, default: null },
        addr4: { type: String, default: null },
        eircode: { type: String, default: null },
        // Common fields
        dateOfBirth: { type: Date, default: null },
        joinDate: { type: Date, default: null },
      },
    ],
    createdBy: {
      type: String,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: "batchVersion",
  }
);

// Indexes for efficient queries
BatchSchema.index({ createdBy: 1 });
BatchSchema.index({ isActive: 1, isDeleted: 1 });
BatchSchema.index({ type: 1 });

// Virtual to get profile count
BatchSchema.virtual("profileCount").get(function () {
  return this.profileIds ? this.profileIds.length : 0;
});

// Ensure virtuals are included in JSON
BatchSchema.set("toJSON", { virtuals: true });
BatchSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Batch", BatchSchema);

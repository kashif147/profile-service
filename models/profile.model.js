const mongoose = require("mongoose");
const ProfileSchema = new mongoose.Schema(
  {
    tenantId: { type: String, index: true },
    isActive: { type: Boolean, default: true }, // True when a subscription is active, false when a subscription is cancelled or resigned
    deactivatedAt: { type: Date, default: null }, // Date of deactivation when a subscription is cancelled or resigned
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: false,
      default: null,
    }, // Azure B2C ID
    // email: { type: String, required: true },
    normalizedEmail: { type: String, required: true },
    membershipNumber: { type: String, unique: true, sparse: true }, // Auto-generated membership number
    firstJoinedDate: { type: Date, default: null }, // Date of first membership
    submissionDate: { type: Date, default: Date.now }, // Date of submission
    // NEW: Pointer to the current subscription
    currentSubscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "subscriptions",
      default: null,
      index: true,
    },
    // Useful to quickly show "View History" button
    hasHistory: { type: Boolean, default: false },
    personalInfo: {
      title: { type: String, default: null },
      surname: { type: String, default: null },
      forename: { type: String, default: null },
      gender: { type: String, default: null },
      dateOfBirth: { type: Date, default: null },
      age: { type: Number, default: null },
      countryPrimaryQualification: { type: String, default: null },
      deceased: { type: Boolean, default: false },
      deceasedDate: { type: Date, default: null },
    },
    contactInfo: {
      nATA: { type: Boolean, default: false },
      preferredAddress: { type: String, default: null },
      buildingOrHouse: { type: String, default: null },
      streetOrRoad: { type: String, default: null },
      areaOrTown: { type: String, default: null },
      eircode: { type: String, default: null },
      countyCityOrPostCode: { type: String, default: null },
      country: { type: String, default: null },
      fullAddress: { type: String, default: null },
      mobileNumber: { type: String, default: null },
      telephoneNumber: { type: String, default: null },
      preferredEmail: { type: String, default: null },
      personalEmail: { type: String, default: null },
      workEmail: { type: String, default: null },
    },
    professionalDetails: {
      retiredDate: { type: Date, default: null },
      pensionNo: { type: String, default: null },
      studyLocation: { type: String, default: null },
      startDate: { type: Date, default: null },
      graduationDate: { type: Date, default: null },
      workLocation: { type: String, default: null },
      payrollNo: { type: String, default: null },
      otherWorkLocation: { type: String, default: null },
      branch: { type: String, default: null },
      region: { type: String, default: null },
      grade: { type: String, default: null },
      otherGrade: { type: String, default: null },
      primarySection: { type: String, default: null },
      otherPrimarySection: { type: String, default: null },
      secondarySection: { type: String, default: null },
      otherSecondarySection: { type: String, default: null },
      nursingAdaptationProgramme: {
        type: Boolean,
        default: false,
      },
      nmbiNumber: { type: String, default: null },
      nurseType: { type: String, default: null },
    },
    preferences: {
      consent: { type: Boolean, default: true },
      valueAddedServices: { type: Boolean, default: false },
      termsAndConditions: { type: Boolean, default: true },
    },
    cornMarket: {
      inmoRewards: { type: Boolean, default: false },
      exclusiveDiscountsAndOffers: { type: Boolean, default: false },
      incomeProtectionScheme: { type: Boolean, default: false },
    },
    additionalInformation: {
      membershipStatus: { type: String, default: null },
      otherIrishTradeUnion: { type: Boolean, default: false },
      otherIrishTradeUnionName: { type: String, default: null },
      otherScheme: { type: Boolean, default: false },
      // submissionDate: { type: Date, default: Date.now },
    },
    recruitmentDetails: {
      recuritedBy: { type: String, default: null },
      recuritedByMembershipNo: { type: String, default: null },
    },
  },
  { timestamps: true, versionKey: "profileVersion" }
);
ProfileSchema.index({ tenantId: 1, normalizedEmail: 1 }, { unique: true });
module.exports = mongoose.model("Profile", ProfileSchema);

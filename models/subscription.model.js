const mongoose = require("mongoose");
const {
  PAYMENT_TYPE,
  PAYMENT_FREQUENCY,
  USER_TYPE,
} = require("../constants/enums");

const SubscriptionSchema = new mongoose.Schema(
  {
    applicationId: { type: String, required: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: false,
      default: null,
    }, // Azure B2C ID
    // membershipNumber: { type: String, unique: true, sparse: true }, // Auto-generated membership number

    subscriptionDetails: {
      paymentType: {
        type: String,
        enum: Object.values(PAYMENT_TYPE),
        default: PAYMENT_TYPE.PAYROLL_DEDUCTION,
      },
      payrollNo: { type: String, allowNull: true },
      paymentFrequency: {
        type: String,
        enum: Object.values(PAYMENT_FREQUENCY),
        default: PAYMENT_FREQUENCY.MONTHLY,
      },
      membershipStatus: { type: String, allowNull: true },
      inmoRewards: { type: Boolean, default: false },
      incomeProtectionScheme: { type: Boolean, default: false },
      exclusiveDiscountsAndOffers: { type: Boolean, default: false },
      otherIrishTradeUnion: { type: Boolean, default: false },
      otherIrishTradeUnionName: { type: String, allowNull: true },
      otherScheme: { type: Boolean, default: false },
      recuritedBy: { type: String, allowNull: true },
      recuritedByMembershipNo: { type: String, allowNull: true },
      confirmedRecruiterProfileId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Profile",
        default: null,
      },
      primarySection: { type: String, allowNull: true },
      otherPrimarySection: { type: String, allowNull: true },
      secondarySection: { type: String, allowNull: true },
      otherSecondarySection: { type: String, allowNull: true },
      valueAddedServices: { type: Boolean, default: false },
      termsAndConditions: { type: Boolean, default: true },
      membershipCategory: { type: String, allowNull: true },
      dateJoined: { type: Date, allowNull: true },
      submissionDate: { type: Date, default: Date.now },
      // dateLeft: { type: Date, allowNull: true },
      // reasonLeft: { type: String, allowNull: true },
    },

    // Payment details for tracking payment information
    paymentDetails: {
      paymentIntentId: { type: String, allowNull: true },
      amount: { type: Number, allowNull: true },
      currency: { type: String, allowNull: true },
      status: { type: String, allowNull: true },
      updatedAt: { type: Date, allowNull: true },
    },

    // // Professional details that will be synced from professional details
    // professionalDetails: {
    //   membershipCategory: { type: String },
    //   workLocation: { type: String },
    //   otherWorkLocation: { type: String },
    //   region: { type: String },
    //   branch: { type: String },
    // },

    meta: {
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "users" },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "users" },
      userType: { type: String, enum: Object.values(USER_TYPE) },
    },
    deleted: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Index for frequently queried field
SubscriptionSchema.index({ applicationId: 1 });

module.exports = mongoose.model("subscriptionDetails", SubscriptionSchema);

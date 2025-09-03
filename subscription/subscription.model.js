// models/subscription.model.js (subscription-service)
import mongoose from "mongoose";

const SubscriptionSchema = new mongoose.Schema(
  {
    tenantId: { type: String, index: true },
    applicationId: { type: String, required: true }, // the source application
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Profile",
      required: true,
    },

    membershipCategory: { type: String },
    membershipStatus: { type: String, index: true },
    dateJoined: { type: Date },
    dateLeft: { type: Date, default: null },
    reasonLeft: { type: String, default: null },
    paymentType: { type: String },
    paymentFrequency: { type: String },
  },
  { timestamps: true, versionKey: "subscriptionVersion" }
);

// Prevent duplicate subs from the same application approval
SubscriptionSchema.index(
  { tenantId: 1, applicationId: 1 },
  { unique: true, name: "uniq_subscription_per_app" }
);

// Query helpers
SubscriptionSchema.index({ tenantId: 1, profileId: 1, createdAt: -1 });

export default mongoose.model("Subscription", SubscriptionSchema);

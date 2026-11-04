const mongoose = require("mongoose");

// P5 owner policy: a portal identity is never bound to an EXISTING profile on the basis of an
// email / member-number match (or an approval LINK/MERGE) alone. Every such candidate binding is
// recorded here as a PENDING identity-link request, to be decided by a separately authorised
// identity-link operation (not implemented here). Same fields as PersonalDetails.identityLink.
const IdentityLinkRequestSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true },
    profileId: { type: String, required: true },
    applicantUserId: { type: String, required: true }, // local synced User._id (or user-service id)
    status: { type: String, enum: ["PENDING"], default: "PENDING" },
    reason: { type: String, required: true }, // PROFILE_UNBOUND | PROFILE_BOUND_TO_OTHER_USER
    profileBound: { type: Boolean, default: false },
    applicationId: { type: String, default: null },
    sources: { type: [String], default: [] }, // approval | portal.my-profile | user.portal.created | ...
    matchedBy: { type: [String], default: [] }, // email | membershipNumber | duplicateReview
    recordedAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { collection: "identityLinkRequests" },
);

IdentityLinkRequestSchema.index(
  { tenantId: 1, profileId: 1, applicantUserId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "PENDING" } },
);

module.exports =
  mongoose.models.IdentityLinkRequest ||
  mongoose.model("IdentityLinkRequest", IdentityLinkRequestSchema);

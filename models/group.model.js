const mongoose = require("mongoose");

/**
 * Generic, reusable member-cohort model — homed in profile-service because it already owns
 * every field used by DYNAMIC criteria (professionalDetails.workLocation/branch/region/grade,
 * primarySection). Intentionally has NO Issue-Management-specific field (no issueId, etc.):
 * other features (issue-service groups, comms segments, etc.) are meant to reference a
 * Group._id as a plain cross-service String, the same way issue-service's planned
 * Issue.groupId does, rather than this model growing feature-specific fields.
 */

const MEMBERSHIP_MODES = ["STATIC", "DYNAMIC"];

const GroupSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null, trim: true },

    membershipMode: {
      type: String,
      enum: MEMBERSHIP_MODES,
      required: true,
      default: "STATIC",
    },

    /** Used when membershipMode === "STATIC" — explicit list of Profile._id strings. */
    staticMemberIds: {
      type: [String],
      default: [],
    },

    /**
     * Used when membershipMode === "DYNAMIC" — matched live against Profile/professionalDetails
     * on every GET /groups/:id/members call (never cached). See services/group.service.js's
     * buildDynamicMemberQuery for exactly how each key maps onto a Profile field, and its
     * comments on `membershipCategory`/`iroUserId` for the two criteria that don't cleanly map
     * onto a field that actually lives on Profile today.
     */
    criteria: {
      workLocation: { type: [String], default: [] },
      section: { type: [String], default: [] },
      grade: { type: [String], default: [] },
      branch: { type: [String], default: [] },
      region: { type: [String], default: [] },
      iroUserId: { type: String, default: null },
      membershipCategory: { type: [String], default: [] },
    },

    createdBy: { type: String, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

GroupSchema.index({ tenantId: 1, isActive: 1 });
GroupSchema.index({ tenantId: 1, name: 1 });
GroupSchema.index({ tenantId: 1, "criteria.workLocation": 1 });
GroupSchema.index({ tenantId: 1, "criteria.branch": 1 });
GroupSchema.index({ tenantId: 1, "criteria.region": 1 });
GroupSchema.index({ tenantId: 1, "criteria.iroUserId": 1 });

const Group = mongoose.model("Group", GroupSchema);
Group.MEMBERSHIP_MODES = MEMBERSHIP_MODES;

module.exports = Group;

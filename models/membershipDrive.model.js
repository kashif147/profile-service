const mongoose = require("mongoose");

/**
 * A recruitment campaign run by a staff member (IRO / branch / region officer) from the
 * MembersHub app. Applications recruited during the drive are tagged on the staging
 * PersonalDetails record (`membershipDrive.driveId`, see personal.details.model.js) via
 * POST /membership-drives/:id/registrations - the Profile itself is not tagged, reporting
 * joins Profile.applicationId -> personalDetails.membershipDrive.driveId instead, so the
 * approval pipeline is untouched.
 *
 * tenantId and ownerUserId always come from the trusted request context (gateway headers /
 * verified JWT), never from the request body - see controllers/membershipDrive.controller.js.
 */

const { DRIVE_STATUSES } = require("../constants/membershipDrive.constants");

const MembershipDriveSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    driveType: { type: String, required: true, trim: true },
    // Work location lookup ids (user-service Lookup), one or more.
    workLocations: { type: [String], default: [] },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    signUpTarget: { type: Number, min: 0, default: 0 },
    notes: { type: String, default: null, trim: true },

    status: { type: String, enum: DRIVE_STATUSES, default: "DRAFT", required: true },
    statusChangedAt: { type: Date, default: null },

    // Staff user who created and owns the drive; only the owner may change it.
    ownerUserId: { type: String, required: true },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true },
);

MembershipDriveSchema.index({ tenantId: 1, ownerUserId: 1, status: 1, startDate: -1 });
MembershipDriveSchema.index({ tenantId: 1, status: 1 });

const MembershipDrive = mongoose.model("MembershipDrive", MembershipDriveSchema);

module.exports = MembershipDrive;

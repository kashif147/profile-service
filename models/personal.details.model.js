const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const {
  APPLICATION_STATUS,
  PREFERRED_ADDRESS,
  PREFERRED_EMAIL,
  USER_TYPE,
} = require("../constants/enums");

const ProfileSchema = new mongoose.Schema(
  {
    personalInfo: {
      title: {
        type: String,
        required: true,
      },
      surname: { type: String, allowNull: true },
      forename: { type: String, allowNull: true },
      gender: {
        type: String,
        required: true,
      },
      dateOfBirth: { type: Date, allowNull: true },
      age: { type: Number, allowNull: true }, //calculated via backend
      // countryPrimaryQualification: { type: String, allowNull: true },
      countryPrimaryQualification: {
        type: String,
        required: true,
        default: null,
      },
      // deceased: { type: Boolean, default: false },
      // deceasedDate: { type: Date, allowNull: true },
    },
    contactInfo: {
      consent: { type: Boolean, default: true }, // consent to receive correspondence from the union
      preferredAddress: {
        type: String,
        enum: Object.values(PREFERRED_ADDRESS),
        default: PREFERRED_ADDRESS.HOME,
      },
      buildingOrHouse: { type: String, allowNull: true },
      streetOrRoad: { type: String, allowNull: true },
      areaOrTown: { type: String, allowNull: true },
      eircode: { type: String, allowNull: true },
      countyCityOrPostCode: { type: String, allowNull: true },
      country: {
        type: String,
        required: true,
        default: null,
      },
      fullAddress: { type: String, allowNull: true }, //calculated via backend
      mobileNumber: { type: String, allowNull: true },
      telephoneNumber: { type: String, allowNull: true },
      preferredEmail: {
        type: String,
        enum: Object.values(PREFERRED_EMAIL),
        default: PREFERRED_EMAIL.PERSONAL,
      },
      personalEmail: { type: String, allowNull: true },
      workEmail: { type: String, allowNull: true },
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: false,
      default: null,
    }, // Azure B2C ID
    applicationId: {
      type: String,
      default: uuidv4,
      unique: true,
    },
    // Application status for approval workflow
    applicationStatus: {
      type: String,
      enum: Object.values(APPLICATION_STATUS),
      default: APPLICATION_STATUS.IN_PROGRESS,
    },
    approvalDetails: {
      approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "users",
        required: false,
      },
      approvedAt: Date,
      rejectionReason: String,
      comments: String,
    },

    // Duplicate detection flags
    duplicateDetection: {
      isPotentialDuplicate: {
        type: Boolean,
        default: false,
        index: true,
      },
      detectedAt: Date,
      matchType: {
        type: String,
        enum: ["exact_email", "exact_mobile", "fuzzy_3of4", null],
        default: null,
      },
      matchedApplicationIds: [
        {
          type: String,
        },
      ],
      matchedProfileIds: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Profile",
        },
      ],
    },

    meta: {
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "users" },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "users" },
      userType: {
        type: String,
        enum: Object.values(USER_TYPE),
        default: USER_TYPE.PORTAL,
      },
      deleted: { type: Boolean, default: false },
      isActive: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

// Indexes for frequently queried fields
ProfileSchema.index({ userId: 1 });
ProfileSchema.index({ applicationId: 1 });
ProfileSchema.index({ "duplicateDetection.isPotentialDuplicate": 1 });
ProfileSchema.index({ "duplicateDetection.matchedApplicationIds": 1 });

module.exports = mongoose.model("personalDetails", ProfileSchema);

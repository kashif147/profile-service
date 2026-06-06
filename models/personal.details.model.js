const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const {
  APPLICATION_STATUS,
  DUPLICATE_REVIEW_STATUS,
  PREFERRED_ADDRESS,
  PREFERRED_EMAIL,
  USER_TYPE,
} = require("../constants/enums");
const {
  stampPersonalInfoFullName,
  applyFullNameToMongooseUpdate,
} = require("../helpers/personal.info.fullName.js");

const ProfileSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    personalInfo: {
      title: {
        type: String,
        required: true,
      },
      surname: { type: String, allowNull: true },
      forename: { type: String, allowNull: true },
      fullName: { type: String, allowNull: true }, // computed from forename + surname
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
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Profile",
      required: false,
      default: null,
      index: true,
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
        enum: [
          "exact_email",
          "exact_mobile",
          "fuzzy_3of4",
          "exact",
          "fuzzy_scored",
          null,
        ],
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

    duplicateReview: {
      status: {
        type: String,
        enum: Object.values(DUPLICATE_REVIEW_STATUS),
        default: DUPLICATE_REVIEW_STATUS.NOT_CHECKED,
        index: true,
      },
      detectedAt: Date,
      matchedProfileId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Profile",
        default: null,
      },
      matchedApplicationId: { type: String, default: null },
      decisionReason: { type: String, default: null },
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "users",
        default: null,
      },
      reviewedAt: Date,
      matchSummary: [
        {
          sourceType: {
            type: String,
            enum: ["PROFILE", "APPLICATION"],
          },
          sourceId: { type: String },
          score: { type: Number },
          classification: { type: String },
          matchedFields: [{ type: String }],
          matchReason: { type: String },
          isExact: { type: Boolean, default: false },
          ignored: { type: Boolean, default: false },
          name: { type: String },
          email: { type: String },
          mobile: { type: String },
          membershipNumber: { type: String },
          applicationNumber: { type: String },
        },
      ],
      auditHistory: [
        {
          action: { type: String },
          reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "users",
          },
          reviewedAt: { type: Date },
          matchScore: { type: Number },
          matchedFields: [{ type: String }],
          decisionReason: { type: String },
          sourceType: { type: String },
          sourceId: { type: String },
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

ProfileSchema.pre("save", function (next) {
  if (this.personalInfo != null) {
    stampPersonalInfoFullName(this.personalInfo);
  }
  next();
});

for (const hook of ["findOneAndUpdate", "updateOne", "updateMany"]) {
  ProfileSchema.pre(hook, function (next) {
    applyFullNameToMongooseUpdate(this.getUpdate());
    next();
  });
}

// Indexes for frequently queried fields
ProfileSchema.index({ userId: 1 });
ProfileSchema.index({ applicationId: 1 });
ProfileSchema.index({ "duplicateDetection.isPotentialDuplicate": 1 });
ProfileSchema.index({ "duplicateDetection.matchedApplicationIds": 1 });
ProfileSchema.index({ tenantId: 1, applicationId: 1 });
ProfileSchema.index({ tenantId: 1, userId: 1 });

module.exports = mongoose.model("personalDetails", ProfileSchema);

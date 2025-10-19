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
    ApplicationId: {
      type: String,
      default: uuidv4,
      unique: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: false,
      default: null,
    }, // Azure B2C ID
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

      deceased: { type: Boolean, default: false },
      deceasedDate: { type: Date, allowNull: true },
    },
    contactInfo: {
      preferredAddress: {
        type: String,
        enum: Object.values(PREFERRED_ADDRESS),
        default: PREFERRED_ADDRESS.HOME,
      },
      eircode: { type: String, allowNull: true },
      buildingOrHouse: { type: String, allowNull: true },
      streetOrRoad: { type: String, allowNull: true },
      areaOrTown: { type: String, allowNull: true },
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
      consent: { type: Boolean, default: false },
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

module.exports = mongoose.model("personalDetails", ProfileSchema);

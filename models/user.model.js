const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  // Tenant isolation - mandatory field
  tenantId: {
    type: String,
    required: true,
    index: true,
  },

  userId: { type: String, index: true }, // Reference to user-service user ID
  userEmail: { type: String, default: null }, // `emails[0]` ADB2C
  userFirstName: { type: String, default: null }, // `given_name` ADB2C
  userLastName: { type: String, default: null }, // `family_name` ADB2C
  userFullName: { type: String, default: null }, //given_name + family_name ADB2C
  userMobilePhone: { type: String, default: null }, // `extension_mobilePhone` ADB2C
  // userMemberNumber: { type: String, default: null }, // `extension_MemberNo` ADB2C
  userMicrosoftId: { type: String, default: null }, // `oid` ADB2C
  // userAuthProvider: { type: String, default: "microsoft" }, // fixed value for tracking auth source ADB2C
  // userSubject: { type: String, default: null }, // `sub` ADB2C
  // userAudience: { type: String, default: null }, // `aud` ADB2C
  // userIssuer: { type: String, default: null }, // `iss` ADB2C
  // userIssuedAt: { type: Number, default: null }, // `iat` ADB2C
  // userAuthTime: { type: Number, default: null }, // `auth_time` ADB2C
  // userTokenVersion: { type: String, default: null }, // `ver` ADB2C
  // userPolicy: { type: String, default: null }, // `tfp` ADB2C
  userType: { type: String, enum: ["PORTAL", "CRM"], default: "PORTAL" }, // PORTAL for B2C, CRM for Azure AD
  // userLastLogin: { type: Date, default: Date.now }, // current timestamp
  // userLastLogout: { type: Date, default: null }, // logout timestamp
  // password: { type: String },

  // RBAC fields
  // roles: [
  //   {
  //     type: mongoose.Schema.Types.ObjectId,
  //     ref: "Role",
  //   },
  // ],
  isActive: {
    type: Boolean,
    default: true,
  },

  // tokens: {
  //   id_token: { type: String, default: null }, // full ID token from Microsoft
  //   refresh_token: { type: String, default: null }, // refresh token
  //   id_token_expires_in: { type: Number, default: null }, // token expiry time (optional)
  //   refresh_token_expires_in: { type: Number, default: null }, // refresh token expiry (optional)
  // },

  // Audit fields
  // createdBy: { type: String, default: null },
  // updatedBy: { type: String, default: null },
  // createdAt: { type: Date, default: Date.now },
  // updatedAt: { type: Date, default: Date.now },
});

// Compound indexes for tenant isolation
UserSchema.index({ tenantId: 1, userEmail: 1 }, { unique: true });
UserSchema.index({ tenantId: 1, userId: 1 }, { unique: true, sparse: true }); // Unique email per tenant
UserSchema.index({ tenantId: 1, userMicrosoftId: 1 }, { unique: true }); // Unique Microsoft ID per tenant
// UserSchema.index({ tenantId: 1, userSubject: 1 }, { unique: true }); // Unique subject per tenant

// Index for refresh token lookups
// UserSchema.index({ "tokens.refresh_token": 1 }, { sparse: true }); // Sparse index for refresh token queries

// Pre-save middleware to update audit fields
// UserSchema.pre("save", function (next) {
//   this.updatedAt = Date.now();
//   next();
// });

module.exports = mongoose.model("User", UserSchema);

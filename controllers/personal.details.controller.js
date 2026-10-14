const personalDetailsService = require("../services/personal.details.service");
const personalDetailsHandler = require("../handlers/personal.details.handler");
const { extractUserAndCreatorContext } = require("../helpers/get.user.info.js");
const joischemas = require("../validation/index.js");
const { AppError } = require("../errors/AppError");
const Profile = require("../models/profile.model.js");
const { normalizeEmail } = require("../helpers/profileLookup.service.js");
const {
  enrichPersonalInfoFullNameOnDocument,
} = require("../helpers/personal.info.fullName.js");

/*
 * Logging: ids, outcomes and error names/codes only. Request headers (Authorization, cookies),
 * bodies, params, req.user / req.ctx, personal-details records and whole error objects are never
 * logged - they carry tokens and personal data (email, names, DOB, address, mobile).
 * Validation/database errors log field names only: Joi details[].path, Mongoose
 * Object.keys(errors), duplicate key Object.keys(keyPattern). error.message is not logged where
 * it can embed values.
 */
function safeErrorFields(error) {
  const fields = { name: error?.name || null, code: error?.code ?? null };
  if (error?.isJoi && Array.isArray(error.details)) {
    fields.fields = error.details.map((d) => (Array.isArray(d.path) ? d.path.join(".") : String(d.path)));
  } else if (error?.name === "ValidationError" && error.errors && typeof error.errors === "object") {
    fields.fields = Object.keys(error.errors);
  } else if (error?.code === 11000) {
    fields.fields = Object.keys(error.keyPattern || {});
  }
  return fields;
}

function logError(operation, error, ids = {}) {
  console.error(`PersonalDetailsController [${operation}] Error:`, { ...ids, ...safeErrorFields(error) });
}

exports.createPersonalDetails = async (req, res, next) => {
  try {
    const { userId, creatorId, userType, tenantId } =
      extractUserAndCreatorContext(req);
    console.log("=== createPersonalDetails START ===");
    console.log("User context:", { tenantId, userId, creatorId, userType });

    const validatedData =
      await joischemas.personal_details_create.validateAsync(req.body);

    // Validate userType early to prevent invalid userTypes from bypassing duplicate checks
    if (!userType) {
      console.error("UserType is missing in request context");
      return next(
        AppError.badRequest(
          "User type is required. Please ensure authentication is valid."
        )
      );
    }

    if (userType !== "CRM" && userType !== "PORTAL") {
      console.error("Invalid userType:", userType);
      return next(
        AppError.badRequest(
          `Invalid user type: ${userType}. Expected PORTAL or CRM.`
        )
      );
    }

    // Perform duplicate check based on userType
    if (userType === "CRM") {
      console.log("CRM user creating personal details - checking by email");
      const email =
        req.body.contactInfo?.personalEmail || req.body.contactInfo?.workEmail;
      if (!email) {
        return next(
          AppError.badRequest(
            "Email is required for CRM users to check for duplicates"
          )
        );
      }
      const existingPersonalDetails = await personalDetailsHandler.getByEmail(
        email,
        tenantId
      );
      const hasActiveApplication =
        existingPersonalDetails &&
        (existingPersonalDetails.meta?.isActive === undefined ||
          existingPersonalDetails.meta?.isActive === true);

      if (hasActiveApplication) {
        return next(
          AppError.conflict(
            "Personal details already exist, please update existing details"
          )
        );
      }
    } else if (userType === "PORTAL") {
      console.log("PORTAL user creating personal details - checking by userId");
      if (!userId) {
        return next(
          AppError.badRequest("User ID is required for portal users")
        );
      }
      const existingPersonalDetails = await personalDetailsHandler.getByUserId(
        userId,
        tenantId
      );
      const hasActiveApplication =
        existingPersonalDetails &&
        (existingPersonalDetails.meta?.isActive === undefined ||
          existingPersonalDetails.meta?.isActive === true);

      if (hasActiveApplication) {
        return next(
          AppError.conflict(
            "Personal details already exist, please update existing details"
          )
        );
      }
    }

    console.log("Creating personal details for userType:", userType);
    const result = await personalDetailsService.createPersonalDetails({
      ...validatedData,
      userId,
      tenantId,
      meta: {
        createdBy: creatorId,
        userType,
        deleted: false,
        isActive: true,
      },
    });

    console.log("=== createPersonalDetails SUCCESS ===", {
      tenantId,
      applicationId: result?.applicationId ?? null,
    });
    enrichPersonalInfoFullNameOnDocument(result);
    return res.success(result);
  } catch (error) {
    logError("createPersonalDetails", error);
    if (error.isJoi) {
      return next(AppError.badRequest("Validation error: " + error.message));
    }
    return next(error);
  }
};

exports.getPersonalDetails = async (req, res, next) => {
  try {
    console.log("=== getPersonalDetails START ===");

    const { userId, userType, tenantId } = extractUserAndCreatorContext(req);
    const applicationId = req.params.applicationId;

    console.log("Extracted context:", { tenantId, userId, userType, applicationId });

    if (!applicationId) {
      return next(AppError.badRequest("Application ID is required"));
    }

    if (!userType) {
      console.error("UserType is missing in request context");
      return next(AppError.badRequest("User type is required. Please ensure authentication is valid."));
    }

    if (userType !== "CRM" && userType !== "PORTAL") {
      console.error("Invalid userType:", userType);
      return next(AppError.badRequest(`Invalid user type: ${userType}. Expected PORTAL or CRM.`));
    }

    if (userType === "PORTAL" && !userId) {
      console.error("Portal user missing userId");
      return next(AppError.badRequest("User ID is required for portal users"));
    }

    const personalDetails = await personalDetailsService.getPersonalDetails(
      applicationId,
      userId,
      userType,
      tenantId
    );

    if (!personalDetails) {
      return res.notFoundRecord("Personal details not found");
    }

    console.log("=== getPersonalDetails SUCCESS ===");
    enrichPersonalInfoFullNameOnDocument(personalDetails);
    return res.success(personalDetails);
  } catch (error) {
    logError("getPersonalDetails", error);
    if (error.message === "Personal details not found") {
      return res.notFoundRecord("Personal details not found");
    }
    return next(error);
  }
};

exports.updatePersonalDetails = async (req, res, next) => {
  try {
    const { userId, userType, creatorId, tenantId } =
      extractUserAndCreatorContext(req);
    const applicationId = req.params.applicationId;

    // Context logging for debugging
    console.log('[updatePersonalDetails] Context:', { tenantId, userId, userType, creatorId, applicationId });

    if (!applicationId) {
      return next(AppError.badRequest('Application ID is required'));
    }

    let validatedData;
    try {
      validatedData = await joischemas.personal_details_update.validateAsync(req.body);
    } catch (validationError) {
      return next(AppError.badRequest('Validation error: ' + validationError.message));
    }

    const updatePayload = {
      ...validatedData,
      "meta.updatedBy": creatorId,
      "meta.userType": userType,
    };

    let result;
    try {
      result = await personalDetailsService.updatePersonalDetails(
        applicationId,
        updatePayload,
        userId,
        userType,
        tenantId
      );
    } catch (err) {
      // Cleanly map specific business errors to AppError
      if (err.message && err.message === 'Personal details not found') {
        return res.notFoundRecord("Personal details not found");
      } else if (err.name === 'ValidationError') {
        return next(AppError.badRequest('Mongoose model validation error: ' + err.message));
      } else if (err.code === 'PERMISSION_DENIED') {
        return next(AppError.forbidden('Not authorized to update personal details'));
      }
      return next(err);
    }

    enrichPersonalInfoFullNameOnDocument(result);
    return res.success(result);
  } catch (error) {
    logError("updatePersonalDetails", error);
    return next(AppError.internal(error.message || 'Internal server error'));
  }
};

exports.deletePersonalDetails = async (req, res, next) => {
  try {
    const { userId, userType, tenantId } = extractUserAndCreatorContext(req);
    const applicationId = req.params.applicationId;

    if (!applicationId) {
      return next(AppError.badRequest("Application ID is required"));
    }

    await personalDetailsService.deletePersonalDetails(
      applicationId,
      userId,
      userType,
      tenantId
    );

    return res.success("Personal details deleted successfully");
  } catch (error) {
    logError("deletePersonalDetails", error);
    if (error.message === "Personal details not found") {
      return res.notFoundRecord("Personal details not found");
    }
    return next(error);
  }
};
exports.getMyPersonalDetails = async (req, res, next) => {
  try {
    console.log("=== getMyPersonalDetails START ===");

    const { userId, userType, tenantId } = extractUserAndCreatorContext(req);
    console.log("Extracted context:", { tenantId, userId, userType });

    // For PORTAL users, get by userId
    if (userType === "PORTAL") {
      if (!userId) {
        console.log("User ID check failed:", userId);
        return next(AppError.badRequest("User ID is required"));
      }

      console.log(
        "Calling personalDetailsService.getMyPersonalDetails with userId:",
        userId
      );
      const personalDetails = await personalDetailsService.getMyPersonalDetails(
        userId,
        tenantId
      );
      console.log("Service response:", { found: Boolean(personalDetails) });

    if (!personalDetails) {
      console.log("No personal details found for user:", userId);
      return res.notFoundRecord("Personal details not found");
    }

      enrichPersonalInfoFullNameOnDocument(personalDetails);
      console.log("=== getMyPersonalDetails SUCCESS ===");
      return res.success(personalDetails);
    } else if (userType === "CRM") {
      // CRM users don't have userId - return not found instead of blocking
      console.log("CRM user called getMyPersonalDetails - no userId available");
      return res.notFoundRecord("Personal details not found");
    } else {
      return next(
        AppError.badRequest(
          `Invalid userType: ${
            userType || "undefined"
          }. Expected PORTAL or CRM.`
        )
      );
    }
  } catch (error) {
    logError("getMyPersonalDetails", error);
    if (error.message === "Personal details not found") {
      return res.notFoundRecord("Personal details not found");
    }
    return next(error);
  }
};

exports.getApplicationStatus = async (req, res, next) => {
  try {
    const { userId, userType, tenantId } = extractUserAndCreatorContext(req);
    const applicationId = req.params.applicationId;

    if (!applicationId) {
      return next(AppError.badRequest("Application ID is required"));
    }

    const applicationStatus = await personalDetailsService.getApplicationStatus(
      applicationId,
      userId,
      userType,
      tenantId
    );

    return res.success({ applicationStatus });
  } catch (error) {
    logError("getApplicationStatus", error);
    if (error.message === "Personal details not found") {
      return res.notFoundRecord("Personal details not found");
    }
    return next(error);
  }
};

exports.checkEmailExists = async (req, res, next) => {
  try {
    console.log("=== checkEmailExists START ===");
    const { email } = req.body;
    const tenantId = req.tenantId;

    // Validate email is provided
    if (!email) {
      return next(AppError.badRequest("Email is required"));
    }

    // Validate email format (basic validation)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return next(AppError.badRequest("Invalid email format"));
    }

    // Normalize email for comparison (lowercase)
    const normalizedEmail = normalizeEmail(email);

    // Build query conditions for Profile lookup
    // Tenant-owned lookup (Phase 2C D): trusted tenant required, never a cross-tenant check.
    if (!tenantId) {
      return next(AppError.unauthorized("Tenant context required"));
    }
    const profileQuery = {
      normalizedEmail: normalizedEmail,
      tenantId,
    };

    // Check if profile exists (approved profiles)
    const existingProfile = await Profile.findOne(profileQuery)
      .select(
        "personalInfo contactInfo membershipNumber _id isActive deactivatedAt"
      )
      .lean();

    // Also check PersonalDetails (applications) for any pending/approved applications
    const emailLower = normalizedEmail.toLowerCase();
    const existingApplication = await personalDetailsHandler.getByEmail(
      emailLower,
      tenantId
    );

    // If profile exists, return profile information
    if (existingProfile) {
      console.log("=== checkEmailExists: Profile found ===");
      enrichPersonalInfoFullNameOnDocument(existingProfile);
      return res.success({
        exists: true,
        status: false, // status false means profile already exists
        message: "Profile with this email already exists",
        profile: {
          profileId: existingProfile._id,
          membershipNumber: existingProfile.membershipNumber,
          personalInfo: existingProfile.personalInfo,
          contactInfo: existingProfile.contactInfo,
          isActive: existingProfile.isActive,
          deactivatedAt: existingProfile.deactivatedAt,
        },
        type: "PROFILE", // Indicates this is an approved profile
      });
    }

    // If application exists but no profile yet
    if (existingApplication) {
      console.log("=== checkEmailExists: Application found ===");
      enrichPersonalInfoFullNameOnDocument(existingApplication);
      return res.success({
        exists: true,
        status: false, // status false means application already exists
        message: "Application with this email already exists",
        application: {
          applicationId: existingApplication.applicationId,
          applicationStatus: existingApplication.applicationStatus,
          personalInfo: existingApplication.personalInfo,
          contactInfo: existingApplication.contactInfo,
        },
        type: "APPLICATION", // Indicates this is a pending application
      });
    }

    // No profile or application found
    console.log("=== checkEmailExists: No profile/application found ===");
    return res.success({
      exists: false,
      status: true, // status true means no profile exists (safe to proceed)
      message: "No profiles with this email already exist",
    });
  } catch (error) {
    logError("checkEmailExists", error);
    return next(error);
  }
};

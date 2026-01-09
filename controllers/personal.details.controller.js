const personalDetailsService = require("../services/personal.details.service");
const personalDetailsHandler = require("../handlers/personal.details.handler");
const { extractUserAndCreatorContext } = require("../helpers/get.user.info.js");
const joischemas = require("../validation/index.js");
const { AppError } = require("../errors/AppError");
const Profile = require("../models/profile.model.js");
const { normalizeEmail } = require("../helpers/profileLookup.service.js");

exports.createPersonalDetails = async (req, res, next) => {
  try {
    const { userId, creatorId, userType } = extractUserAndCreatorContext(req);
    console.log("=== createPersonalDetails START ===");
    console.log("User context:", { userId, creatorId, userType });

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
        email
      );
      if (existingPersonalDetails) {
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
        userId
      );
      if (existingPersonalDetails) {
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
      meta: { createdBy: creatorId, userType },
    });

    console.log("=== createPersonalDetails SUCCESS ===");
    return res.success(result);
  } catch (error) {
    console.error(
      "PersonalDetailsController [createPersonalDetails] Error:",
      error
    );
    if (error.isJoi) {
      return next(AppError.badRequest("Validation error: " + error.message));
    }
    return next(error);
  }
};

exports.getPersonalDetails = async (req, res, next) => {
  try {
    console.log("=== getPersonalDetails START ===");
    console.log("Request params:", req.params);
    console.log("Request user:", req.user);
    console.log("Request ctx:", req.ctx);

    const { userId, userType } = extractUserAndCreatorContext(req);
    const applicationId = req.params.applicationId;

    console.log("Extracted context:", { userId, userType, applicationId });

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
      userType
    );

    if (!personalDetails) {
      return res.notFoundRecord("Personal details not found");
    }

    console.log("=== getPersonalDetails SUCCESS ===");
    return res.success(personalDetails);
  } catch (error) {
    console.error(
      "PersonalDetailsController [getPersonalDetails] Error:",
      error
    );
    console.error("Error stack:", error.stack);
    if (error.message === "Personal details not found") {
      return res.notFoundRecord("Personal details not found");
    }
    return next(error);
  }
};

exports.updatePersonalDetails = async (req, res, next) => {
  try {
    const { userId, userType, creatorId } = extractUserAndCreatorContext(req);
    const applicationId = req.params.applicationId;

    // Context logging for debugging
    console.log('[updatePersonalDetails] req.user:', req.user);
    console.log('[updatePersonalDetails] Context:', { userId, userType, creatorId, applicationId });

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
      meta: { updatedBy: creatorId, userType },
    };

    let result;
    try {
      result = await personalDetailsService.updatePersonalDetails(
        applicationId,
        updatePayload,
        userId,
        userType
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

    return res.success(result);
  } catch (error) {
    console.error(
      'PersonalDetailsController [updatePersonalDetails] Error:',
      error
    );
    return next(AppError.internal(error.message || 'Internal server error'));
  }
};

exports.deletePersonalDetails = async (req, res, next) => {
  try {
    const { userId, userType } = extractUserAndCreatorContext(req);
    const applicationId = req.params.applicationId;

    if (!applicationId) {
      return next(AppError.badRequest("Application ID is required"));
    }

    await personalDetailsService.deletePersonalDetails(
      applicationId,
      userId,
      userType
    );

    return res.success("Personal details deleted successfully");
  } catch (error) {
    console.error(
      "PersonalDetailsController [deletePersonalDetails] Error:",
      error
    );
    if (error.message === "Personal details not found") {
      return res.notFoundRecord("Personal details not found");
    }
    return next(error);
  }
};
exports.getMyPersonalDetails = async (req, res, next) => {
  try {
    console.log("=== getMyPersonalDetails START ===");
    console.log("Request headers:", req.headers);
    console.log("Request user:", req.user);
    console.log("Request ctx:", req.ctx);

    const { userId, userType } = extractUserAndCreatorContext(req);
    console.log("Extracted context:", { userId, userType });

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
        userId
      );
      console.log("Service response:", personalDetails);

    if (!personalDetails) {
      console.log("No personal details found for user:", userId);
      return res.notFoundRecord("Personal details not found");
    }

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
    console.error(
      "PersonalDetailsController [getMyPersonalDetails] Error:",
      error
    );
    console.error("Error stack:", error.stack);
    if (error.message === "Personal details not found") {
      return res.notFoundRecord("Personal details not found");
    }
    return next(error);
  }
};

exports.getApplicationStatus = async (req, res, next) => {
  try {
    const { userId, userType } = extractUserAndCreatorContext(req);
    const applicationId = req.params.applicationId;

    if (!applicationId) {
      return next(AppError.badRequest("Application ID is required"));
    }

    const applicationStatus = await personalDetailsService.getApplicationStatus(
      applicationId,
      userId,
      userType
    );

    return res.success({ applicationStatus });
  } catch (error) {
    console.error(
      "PersonalDetailsController [getApplicationStatus] Error:",
      error
    );
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
    const profileQuery = {
      normalizedEmail: normalizedEmail,
    };

    // Add tenantId if available
    if (tenantId) {
      profileQuery.tenantId = tenantId;
    }

    // Check if profile exists (approved profiles)
    const existingProfile = await Profile.findOne(profileQuery)
      .select(
        "personalInfo contactInfo membershipNumber _id isActive deactivatedAt"
      )
      .lean();

    // Also check PersonalDetails (applications) for any pending/approved applications
    const emailLower = normalizedEmail.toLowerCase();
    const existingApplication = await personalDetailsHandler.getByEmail(
      emailLower
    );

    // If profile exists, return profile information
    if (existingProfile) {
      console.log("=== checkEmailExists: Profile found ===");
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
    console.error(
      "PersonalDetailsController [checkEmailExists] Error:",
      error
    );
    return next(error);
  }
};

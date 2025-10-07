const personalDetailsService = require("../services/personal.details.service");
const personalDetailsHandler = require("../handlers/personal.details.handler");
const { extractUserAndCreatorContext } = require("../helpers/get.user.info.js");
const joischemas = require("../validation/index.js");
const policyClient = require("../utils/policyClient");
const { AppError } = require("../errors/AppError");

exports.createPersonalDetails = async (req, res, next) => {
  try {
    const { userId, creatorId, userType } = extractUserAndCreatorContext(req);

    const validatedData =
      await joischemas.personal_details_create.validateAsync(req.body);

    if (userType === "CRM") {
      const email =
        req.body.contactInfo?.personalEmail || req.body.contactInfo?.workEmail;
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
    } else {
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

    const result = await personalDetailsService.createPersonalDetails({
      ...validatedData,
      userId,
      meta: { createdBy: creatorId, userType },
    });

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
    const { userId, userType } = extractUserAndCreatorContext(req);
    const applicationId = req.params.applicationId;

    if (!applicationId) {
      return next(AppError.badRequest("Application ID is required"));
    }

    const personalDetails = await personalDetailsService.getPersonalDetails(
      applicationId,
      userId,
      userType
    );
    return res.success(personalDetails);
  } catch (error) {
    console.error(
      "PersonalDetailsController [getPersonalDetails] Error:",
      error
    );
    if (error.message === "Personal details not found") {
      return next(AppError.notFound("Personal details not found"));
    }
    return next(error);
  }
};

exports.updatePersonalDetails = async (req, res, next) => {
  try {
    const { userId, userType, creatorId } = extractUserAndCreatorContext(req);
    const applicationId = req.params.applicationId;

    if (!applicationId) {
      return next(AppError.badRequest("Application ID is required"));
    }

    const validatedData =
      await joischemas.personal_details_update.validateAsync(req.body);
    const updatePayload = {
      ...validatedData,
      meta: { updatedBy: creatorId, userType },
    };

    const result = await personalDetailsService.updatePersonalDetails(
      applicationId,
      updatePayload,
      userId,
      userType
    );

    return res.success(result);
  } catch (error) {
    console.error(
      "PersonalDetailsController [updatePersonalDetails] Error:",
      error
    );
    if (error.isJoi) {
      return next(AppError.badRequest("Validation error: " + error.message));
    }
    if (error.message === "Personal details not found") {
      return next(AppError.notFound("Personal details not found"));
    }
    return next(error);
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
      return next(AppError.notFound("Personal details not found"));
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

    // Only allow PORTAL users to access this endpoint
    if (userType !== "PORTAL") {
      console.log("User type check failed:", userType);
      return next(AppError.forbidden("Access denied. Only for PORTAL users."));
    }

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
      return next(
        AppError.notFound("Personal details not found for this user")
      );
    }

    console.log("=== getMyPersonalDetails SUCCESS ===");
    return res.success(personalDetails);
  } catch (error) {
    console.error(
      "PersonalDetailsController [getMyPersonalDetails] Error:",
      error
    );
    console.error("Error stack:", error.stack);
    if (error.message === "Personal details not found") {
      return next(AppError.notFound("Personal details not found"));
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
      return next(AppError.notFound("Application not found"));
    }
    return next(error);
  }
};

const professionalDetailsService = require("../services/professional.details.service");
const subscriptionDetailsHandler = require("../handlers/subscription.details.handler");
const personalDetailsHandler = require("../handlers/personal.details.handler");
const { extractUserAndCreatorContext } = require("../helpers/get.user.info.js");
const joischemas = require("../validation/index.js");
const { AppError } = require("../errors/AppError");

// Function to update subscription details with professional details
// const updateSubscriptionWithProfessionalDetails = async (userId, professionalDetails) => {
//   try {
//     // Check if subscription details exist for this user
//     const existingSubscription = await subscriptionDetailsHandler.getByUserId(userId);
//     if (existingSubscription) {
//       // Extract common fields from professional details
//       const commonFields = {
//         membershipCategory: professionalDetails.membershipCategory,
//         workLocation: professionalDetails.workLocation,
//         otherWorkLocation: professionalDetails.otherWorkLocation,
//         region: professionalDetails.region,
//         branch: professionalDetails.branch,
//       };

//       // Update subscription details with professional details
//       await subscriptionDetailsHandler.updateByUserId(userId, {
//         professionalDetails: commonFields,
//       });
//     }
//   } catch (error) {
//     console.error("Error updating subscription with professional details:", error);
//   }
// };

exports.createProfessionalDetails = async (req, res, next) => {
  try {
    const { userId, userType, creatorId } = extractUserAndCreatorContext(req);
    const validatedData =
      await joischemas.professional_details_create.validateAsync(req.body);

    // Get application ID from URL parameters
    const applicationId = req.params.applicationId;

    // Create new professional details
    const result = await professionalDetailsService.createProfessionalDetails(
      validatedData,
      applicationId,
      userId,
      userType
    );

    return res.success(result);
  } catch (error) {
    console.error(
      "ProfessionalDetailsController [createProfessionalDetails] Error:",
      error
    );
    if (error.isJoi) {
      return next(AppError.badRequest("Validation error: " + error.message));
    }
    return next(error);
  }
};

exports.getProfessionalDetails = async (req, res, next) => {
  try {
    const { userId, userType } = extractUserAndCreatorContext(req);
    const applicationId = req.params.applicationId;

    console.log(`[PROFESSIONAL_DETAILS] Getting professional details for:`, {
      userId,
      userType,
      applicationId,
    });

    if (!applicationId) {
      return next(AppError.badRequest("Application ID is required"));
    }

    const professionalDetails =
      await professionalDetailsService.getProfessionalDetails(
        applicationId,
        userId,
        userType
      );
    return res.success(professionalDetails);
  } catch (error) {
    console.error(
      "ProfessionalDetailsController [getProfessionalDetails] Error:",
      error
    );
    if (error.message === "Professional details not found") {
      return next(AppError.notFound("Professional details not found"));
    }
    return next(error);
  }
};

exports.updateProfessionalDetails = async (req, res, next) => {
  try {
    const { userId, userType, creatorId } = extractUserAndCreatorContext(req);
    const applicationId = req.params.applicationId;

    if (!applicationId) {
      return next(AppError.badRequest("Application ID is required"));
    }

    const validatedData =
      await joischemas.professional_details_update.validateAsync(req.body);
    const updatePayload = {
      ...validatedData,
      meta: { updatedBy: creatorId, userType },
    };

    const result = await professionalDetailsService.updateProfessionalDetails(
      applicationId,
      updatePayload,
      userId,
      userType
    );

    return res.success(result);
  } catch (error) {
    console.error(
      "ProfessionalDetailsController [updateProfessionalDetails] Error:",
      error
    );
    if (error.isJoi) {
      return next(AppError.badRequest("Validation error: " + error.message));
    }
    if (error.message === "Professional details not found") {
      return next(AppError.notFound("Professional details not found"));
    }
    return next(error);
  }
};

exports.deleteProfessionalDetails = async (req, res, next) => {
  try {
    const { userId, userType } = extractUserAndCreatorContext(req);
    const applicationId = req.params.applicationId;

    if (!applicationId) {
      return next(AppError.badRequest("Application ID is required"));
    }

    await professionalDetailsService.deleteProfessionalDetails(
      applicationId,
      userId,
      userType
    );

    return res.success("Professional details deleted successfully");
  } catch (error) {
    console.error(
      "ProfessionalDetailsController [deleteProfessionalDetails] Error:",
      error
    );
    if (error.message === "Professional details not found") {
      return next(AppError.notFound("Professional details not found"));
    }
    return next(error);
  }
};

exports.getMyProfessionalDetails = async (req, res, next) => {
  try {
    const { userId, userType } = extractUserAndCreatorContext(req);

    // For PORTAL users, get by userId
    if (userType === "PORTAL") {
      if (!userId) {
        return next(AppError.badRequest("User ID is required"));
      }

      const professionalDetails =
        await professionalDetailsService.getMyProfessionalDetails(userId);

      if (!professionalDetails) {
        return next(
          AppError.notFound("Professional details not found for this user")
        );
      }

      return res.success(professionalDetails);
    } else if (userType === "CRM") {
      // CRM users don't have userId - return not found instead of blocking
      return next(
        AppError.notFound(
          "Professional details not found. CRM users should use GET /api/professional-details/:applicationId endpoint"
        )
      );
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
      "ProfessionalDetailsController [getMyProfessionalDetails] Error:",
      error
    );
    if (error.message === "Professional details not found") {
      return next(AppError.notFound("Professional details not found"));
    }
    return next(error);
  }
};

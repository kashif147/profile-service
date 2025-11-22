const applicationService = require("../services/application.service");
const { extractUserAndCreatorContext } = require("../helpers/get.user.info.js");
const joischemas = require("../validation/index.js");
const { AppError } = require("../errors/AppError");
// const { emitApplicationApproved, emitApplicationRejected } = require("../events/applicationEvents");

exports.getAllApplications = async (req, res, next) => {
  try {
    const { userType } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM user can view applications."
        )
      );
    }

    const validatedQuery =
      await joischemas.application_status_query.validateAsync(req.query);

    let statusFilters = [];
    if (validatedQuery.type) {
      if (Array.isArray(validatedQuery.type)) {
        statusFilters = validatedQuery.type;
      } else {
        statusFilters = [validatedQuery.type];
      }
    }

    const applicationsWithDetails =
      await applicationService.getAllApplicationsWithDetails(statusFilters);

    return res.success({
      filter: validatedQuery.type || "all",
      total: applicationsWithDetails.length,
      applications: applicationsWithDetails,
    });
  } catch (error) {
    console.error("ApplicationController [getAllApplications] Error:", error);
    if (error.isJoi) {
      return next(AppError.badRequest("Validation error: " + error.message));
    }
    return next(error);
  }
};

exports.getApplicationById = async (req, res, next) => {
  try {
    const { userType } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM users can view applications."
        )
      );
    }
    const { applicationId } = req.params;

    const applicationDetails =
      await applicationService.getApplicationWithDetails(applicationId);
    
    if (!applicationDetails) {
      return res.status(200).json({
        data: null,
        message: "Not found"
      });
    }
    
    return res.success(applicationDetails);
  } catch (error) {
    console.error("ApplicationController [getApplicationById] Error:", error);
    if (error.message === "Application not found") {
      return res.status(200).json({
        data: null,
        message: "Not found"
      });
    }
    return next(error);
  }
};

exports.approveApplication = async (req, res, next) => {
  try {
    // Check if user is CRM
    const { userType, creatorId } = extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM users can approve applications."
        )
      );
    }

    const { applicationId } = req.params;

    // Validate request body
    const validatedData = await joischemas.application_approve.validateAsync(
      req.body
    );
    const { comments, applicationStatus } = validatedData;

    // Use the application service
    const updatedApplication = await applicationService.updateApplicationStatus(
      applicationId,
      applicationStatus,
      creatorId,
      comments
    );

    // // Get subscription details for the user
    // const subscriptionDetails = await SubscriptionDetails.findOne({
    //   userId: updatedApplication.userId,
    //   "meta.deleted": false,
    // });

    // // Prepare event data
    // const eventData = {
    //   personalDetails: updatedApplication,
    //   subscriptionDetails: subscriptionDetails,
    //   approvalDetails: updatedApplication.approvalDetails,
    // };

    // // Emit appropriate event based on status
    // if (applicationStatus === "approved") {
    //   await emitApplicationApproved(eventData);
    // } else if (applicationStatus === "rejected") {
    //   await emitApplicationRejected(eventData);
    // }

    return res.success({
      applicationId: updatedApplication.applicationId,
      applicationStatus: updatedApplication.applicationStatus,
      approvalDetails: updatedApplication.approvalDetails,
    });
  } catch (error) {
    console.error("ApplicationController [approveApplication] Error:", error);
    if (error.isJoi) {
      return next(AppError.badRequest("Validation error: " + error.message));
    }
    if (error.message.includes("Invalid status")) {
      return next(AppError.badRequest(error.message));
    }
    if (error.message.includes("Application not found")) {
      return next(AppError.notFound("Application not found"));
    }
    return next(error);
  }
};

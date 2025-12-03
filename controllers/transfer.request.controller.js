const TransferRequest = require("../models/transfer.request.model");
const Profile = require("../models/profile.model");
const User = require("../models/user.model"); // Import User model to ensure it's registered with Mongoose
const { AppError } = require("../errors/AppError");
const { extractUserAndCreatorContext } = require("../helpers/get.user.info.js");
const axios = require("axios");
const mongoose = require("mongoose");

/**
 * Submit a new transfer request
 * Body: { currentWorkLocationId, requestedWorkLocationId, reason }
 */
exports.submitTransferRequest = async (req, res, next) => {
  try {
    const { currentWorkLocationId, requestedWorkLocationId, reason } = req.body;
    const { userId } = extractUserAndCreatorContext(req);

    if (!currentWorkLocationId) {
      return next(AppError.badRequest("Current work location ID is required"));
    }

    if (!requestedWorkLocationId) {
      return next(AppError.badRequest("Requested work location ID is required"));
    }

    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return next(AppError.badRequest("Transfer reason is required"));
    }

    if (!userId) {
      return next(AppError.badRequest("User ID is required"));
    }

    // Convert userId string to ObjectId if it's a valid ObjectId
    let userIdObjectId;
    if (mongoose.Types.ObjectId.isValid(userId)) {
      userIdObjectId = new mongoose.Types.ObjectId(userId);
    } else {
      return next(AppError.badRequest("Invalid user ID format"));
    }

    const profile = await Profile.findOne({
      userId: userIdObjectId,
      isActive: true,
    });

    console.log("User ID:---------------------------------  ", userId);

    if (!profile) {
      return next(AppError.notFound("Profile not found for this user"));
    }

    // Check if there's already a pending request
    const existingPendingRequest = await TransferRequest.findOne({
      userId: userIdObjectId,
      status: "PENDING",
    });

    if (existingPendingRequest) {
      return next(
        AppError.conflict("You already have a pending transfer request")
      );
    }

    // Create transfer request
    const transferRequest = await TransferRequest.create({
      userId: userIdObjectId,
      profileId: profile._id,
      currentWorkLocationId: currentWorkLocationId,
      requestedWorkLocationId: requestedWorkLocationId,
      reason: reason.trim(),
      // Request date is when the user submits the transfer request.
      requestDate: new Date(),
      status: "PENDING",
    });

    return res.status(201).json({
      success: true,
      message: "Transfer request submitted successfully",
      data: transferRequest,
    });
  } catch (error) {
    console.error("Error submitting transfer request:", error);
    return next(AppError.internalServerError("Failed to submit transfer request"));
  }
};


/**
 * Get transfer requests for CRM users
 * CRM users can see all transfer requests with filters
 */
exports.getTransferRequestsForCRM = async (req, res, next) => {
  try {
    const { status, userId } = req.query;

    const query = {};

    if (userId) {
      // Convert userId string to ObjectId if it's a valid ObjectId
      if (mongoose.Types.ObjectId.isValid(userId)) {
        query.userId = new mongoose.Types.ObjectId(userId);
      } else {
        return next(AppError.badRequest("Invalid userId format"));
      }
    }

    if (status) {
      query.status = status.toUpperCase();
    }

    const transferRequests = await TransferRequest.find(query)
      .sort({ createdAt: -1 })
      .populate("userId", "userEmail userFullName")
      .populate("profileId", "membershipNumber")
      .lean();

    // Fetch work location hierarchy for each transfer request
    const userServiceUrl =
      process.env.POLICY_SERVICE_URL || "http://localhost:3000";

    const transferRequestsWithDetails = await Promise.all(
      transferRequests.map(async (request) => {
        try {
          // Fetch hierarchy for current work location
          const currentLocationResponse = await axios.get(
            `${userServiceUrl}/api/lookup/${request.currentWorkLocationId}/hierarchy`,
            {
              headers: {
                Authorization: req.headers.authorization,
              },
            }
          );

          const currentLocationData = currentLocationResponse.data || {};
          const currentWorkLocationName =
            currentLocationData.workLocation?.DisplayName ||
            currentLocationData.requestedLookup?.DisplayName ||
            null;
          const currentBranchName = currentLocationData.branch?.DisplayName || null;
          const currentRegionName = currentLocationData.region?.DisplayName || null;

          // Fetch hierarchy for requested work location
          const requestedLocationResponse = await axios.get(
            `${userServiceUrl}/api/lookup/${request.requestedWorkLocationId}/hierarchy`,
            {
              headers: {
                Authorization: req.headers.authorization,
              },
            }
          );

          const requestedLocationData = requestedLocationResponse.data || {};
          const requestedWorkLocationName =
            requestedLocationData.workLocation?.DisplayName ||
            requestedLocationData.requestedLookup?.DisplayName ||
            null;
          const requestedBranchName = requestedLocationData.branch?.DisplayName || null;
          const requestedRegionName = requestedLocationData.region?.DisplayName || null;

          return {
            ...request,
            currentWorkLocationName,
            currentBranchName,
            currentRegionName,
            requestedWorkLocationName,
            requestedBranchName,
            requestedRegionName,
          };
        } catch (error) {
          console.error(
            `Error fetching work location details for request ${request._id}:`,
            error.message
          );
          // Return request without location details if lookup fails
          return {
            ...request,
            currentWorkLocationName: null,
            currentBranchName: null,
            currentRegionName: null,
            requestedWorkLocationName: null,
            requestedBranchName: null,
            requestedRegionName: null,
          };
        }
      })
    );

    return res.status(200).json({
      success: true,
      // data: transferRequests,
      data: transferRequestsWithDetails,
    });
  } catch (error) {
    console.error("Error fetching transfer requests for CRM:", error);
    return next(AppError.internalServerError("Failed to fetch transfer requests"));
  }
};

/**
 * Get transfer requests for Portal users
 * Portal users can only see their own requests
 */
exports.getTransferRequestsForPortal = async (req, res, next) => {
  try {
    const { userId: currentUserId, userType } = extractUserAndCreatorContext(req);
    const { status } = req.query;

    if (userType !== "PORTAL") {
      return next(AppError.forbidden("This endpoint is only for Portal users"));
    }

    if (!currentUserId) {
      return next(AppError.badRequest("User ID is required"));
    }

    // Convert userId string to ObjectId if it's a valid ObjectId
    let userIdObjectId;
    if (mongoose.Types.ObjectId.isValid(currentUserId)) {
      userIdObjectId = new mongoose.Types.ObjectId(currentUserId);
    } else {
      return next(AppError.badRequest("Invalid user ID format"));
    }

    const query = {
      userId: userIdObjectId,
    };

    if (status) {
      query.status = status.toUpperCase();
    }

    const transferRequests = await TransferRequest.find(query)
      .sort({ createdAt: -1 })
      .populate("userId", "userEmail userFullName")
      .populate("profileId", "membershipNumber")
      .lean();

    // Fetch work location hierarchy for each transfer request
    const userServiceUrl =
      process.env.POLICY_SERVICE_URL || "http://localhost:3000";

    const transferRequestsWithDetails = await Promise.all(
      transferRequests.map(async (request) => {
        try {
          // Fetch hierarchy for current work location
          const currentLocationResponse = await axios.get(
            `${userServiceUrl}/api/lookup/${request.currentWorkLocationId}/hierarchy`,
            {
              headers: {
                Authorization: req.headers.authorization,
              },
            }
          );

          const currentLocationData = currentLocationResponse.data || {};
          const currentWorkLocationName =
            currentLocationData.workLocation?.DisplayName ||
            currentLocationData.requestedLookup?.DisplayName ||
            null;
          const currentBranchName = currentLocationData.branch?.DisplayName || null;
          const currentRegionName = currentLocationData.region?.DisplayName || null;

          // Fetch hierarchy for requested work location
          const requestedLocationResponse = await axios.get(
            `${userServiceUrl}/api/lookup/${request.requestedWorkLocationId}/hierarchy`,
            {
              headers: {
                Authorization: req.headers.authorization,
              },
            }
          );

          const requestedLocationData = requestedLocationResponse.data || {};
          const requestedWorkLocationName =
            requestedLocationData.workLocation?.DisplayName ||
            requestedLocationData.requestedLookup?.DisplayName ||
            null;
          const requestedBranchName = requestedLocationData.branch?.DisplayName || null;
          const requestedRegionName = requestedLocationData.region?.DisplayName || null;

          return {
            ...request,
            currentWorkLocationName,
            currentBranchName,
            currentRegionName,
            requestedWorkLocationName,
            requestedBranchName,
            requestedRegionName,
          };
        } catch (error) {
          console.error(
            `Error fetching work location details for request ${request._id}:`,
            error.message
          );
          // Return request without location details if lookup fails
          return {
            ...request,
            currentWorkLocationName: null,
            currentBranchName: null,
            currentRegionName: null,
            requestedWorkLocationName: null,
            requestedBranchName: null,
            requestedRegionName: null,
          };
        }
      })
    );

    return res.status(200).json({
      success: true,
      data: transferRequestsWithDetails,
    });
  } catch (error) {
    console.error("Error fetching transfer requests for Portal:", error);
    return next(AppError.internalServerError("Failed to fetch transfer requests"));
  }
};

/**
 * Backward-compatible route handler that routes to appropriate function based on userType
 * This maintains compatibility with the old /api/transfer-request endpoint
 */
exports.getTransferRequests = async (req, res, next) => {
  try {
    const { userType } = extractUserAndCreatorContext(req);
    
    if (userType === "CRM") {
      return exports.getTransferRequestsForCRM(req, res, next);
    } else if (userType === "PORTAL") {
      return exports.getTransferRequestsForPortal(req, res, next);
    } else {
      return next(AppError.badRequest("Invalid user type"));
    }
  } catch (error) {
    console.error("Error in getTransferRequests router:", error);
    return next(AppError.internalServerError("Failed to fetch transfer requests"));
  }
};

/**
 * Approve or reject transfer request
 * PUT /transfer-request/:requestId
 * Body: { action: "APPROVE" | "REJECT", reason?: string }
 */
exports.reviewTransferRequest = async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const { action, reason } = req.body;

    if (!action || !["APPROVE", "REJECT"].includes(action.toUpperCase())) {
      return next(AppError.badRequest("Action must be 'APPROVE' or 'REJECT'"));
    }

    const transferRequest = await TransferRequest.findOne({
      _id: requestId,
      status: "PENDING",
    });

    if (!transferRequest) {
      return next(
        AppError.notFound("Transfer request not found or already processed")
      );
    }

    const isApprove = action.toUpperCase() === "APPROVE";

    // If CRM user provided an updated reason, persist it
    if (reason && typeof reason === "string" && reason.trim()) {
      transferRequest.reason = reason.trim();
    }

    // If approved, set transfer date to the current time
    if (isApprove) {
      transferRequest.transferDate = new Date();
    }

    // Update transfer request status
    transferRequest.status = isApprove ? "APPROVED" : "REJECTED";
    await transferRequest.save();

    // If approved, update work location, branch, and region in profile
    if (isApprove) {
      const profile = await Profile.findById(transferRequest.profileId);
      if (profile) {
        try {
          // Fetch work location hierarchy from user-service to get work location, branch and region
          const userServiceUrl =
            process.env.POLICY_SERVICE_URL || "http://localhost:3000";
          const lookupResponse = await axios.get(
            `${userServiceUrl}/api/lookup/${transferRequest.requestedWorkLocationId}/hierarchy`,
            {
              headers: {
                Authorization: req.headers.authorization,
              },
            }
          );

          const lookupData = lookupResponse.data || {};

          // Extract DisplayNames from hierarchy response (save as strings, not IDs)
          // For work location use convenience field if present, otherwise fallback to requestedLookup.
          const workLocationName =
            lookupData.workLocation?.DisplayName ||
            lookupData.requestedLookup?.DisplayName ||
            null;
          const branchName = lookupData.branch?.DisplayName || null;
          const regionName = lookupData.region?.DisplayName || null;

          // Update profile with DisplayName strings (not IDs)
          if (!profile.professionalDetails) {
            profile.professionalDetails = {};
          }
          profile.professionalDetails.workLocation = workLocationName;
          profile.professionalDetails.branch = branchName;
          profile.professionalDetails.region = regionName;
          await profile.save();

          console.log(
            `✅ Updated user profile - Work Location: ${workLocationName}, Branch: ${branchName}, Region: ${regionName}`
          );

          // Add work location, branch and region names to transfer request for response
          transferRequest.workLocationName = workLocationName;
          transferRequest.branchName = branchName;
          transferRequest.regionName = regionName;
        } catch (error) {
          console.error(
            "Error fetching work location details from user-service:",
            error.message
          );
          // Still update work location even if lookup fetch fails
          if (!profile.professionalDetails) {
            profile.professionalDetails = {};
          }
          profile.professionalDetails.workLocation =
            transferRequest.requestedWorkLocationId;
          await profile.save();
          // Log warning but don't fail the request
          console.warn(
            "Updated work location but could not update branch/region due to lookup fetch error"
          );
        }
      }
    }

    // Convert to plain object and include branch/region names in response
    const responseData = transferRequest.toObject
      ? transferRequest.toObject()
      : { ...transferRequest };

    return res.status(200).json({
      success: true,
      message: `Transfer request ${isApprove ? "approved" : "rejected"} successfully`,
      data: responseData,
    });
  } catch (error) {
    console.error("Error reviewing transfer request:", error);
    return next(AppError.internalServerError("Failed to review transfer request"));
  }
};


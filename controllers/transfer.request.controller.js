const TransferRequest = require("../models/transfer.request.model");
const Profile = require("../models/profile.model");
const { AppError } = require("../errors/AppError");
const { extractUserAndCreatorContext } = require("../helpers/get.user.info.js");
const axios = require("axios");

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

    const profile = await Profile.findOne({
      userId: userId,
      isActive: true,
    });

    if (!profile) {
      return next(AppError.notFound("Profile not found for this user"));
    }

    // Check if there's already a pending request
    const existingPendingRequest = await TransferRequest.findOne({
      userId: userId,
      status: "PENDING",
    });

    if (existingPendingRequest) {
      return next(
        AppError.conflict("You already have a pending transfer request")
      );
    }

    // Create transfer request
    const transferRequest = await TransferRequest.create({
      userId: userId,
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


exports.getTransferRequests = async (req, res, next) => {
  try {
    const { userId: contextUserId } = extractUserAndCreatorContext(req);
    const { status, userId, myRequests } = req.query;

    const query = {};

    // If myRequests=true, only get current user's requests
    if (myRequests === "true") {
      query.userId = contextUserId;
    } else if (userId) {
      query.userId = userId;
    }

    if (status) {
      query.status = status;
    }

    const transferRequests = await TransferRequest.find(query)
      .sort({ createdAt: -1 })
      .populate("userId", "userEmail userFullName userMemberNumber")
      .populate("profileId", "membershipNumber")
      .lean();

    return res.status(200).json({
      success: true,
      data: transferRequests,
    });
  } catch (error) {
    console.error("Error fetching transfer requests:", error);
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


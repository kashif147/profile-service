const Batch = require("../models/batch.model.js");
const Profile = require("../models/profile.model.js");
const User = require("../models/user.model.js");
const { AppError } = require("../errors/AppError");
const axios = require("axios");

/**
 * Helper function to fetch subscription startDate for profiles
 */
async function fetchSubscriptionStartDates(profileIds, authHeader) {
  const subscriptionStartMap = new Map();
  if (profileIds.length === 0) return subscriptionStartMap;

  const subscriptionServiceUrl =
    process.env.SUBSCRIPTION_SERVICE_URL ||
    "https://subscriptionserviceshell-ambyf5dsa8c9dhcg.northeurope-01.azurewebsites.net";

  const subscriptionPromises = profileIds.map(async (profileId) => {
    try {
      const response = await axios.get(
        `${subscriptionServiceUrl}/api/v1/subscriptions/profile/${profileId}/current`,
        {
          timeout: 10000,
          validateStatus: (status) => status < 500,
          headers: {
            Authorization: authHeader || "",
          },
        }
      );

      if (response.status === 200 && response.data?.data?.startDate) {
        return {
          profileId: profileId.toString(),
          startDate: response.data.data.startDate,
        };
      }
      return null;
    } catch (error) {
      console.warn(
        `Failed to fetch subscription for profile ${profileId}:`,
        error.message
      );
      return null;
    }
  });

  const subscriptionResults = await Promise.all(subscriptionPromises);
  return new Map(
    subscriptionResults.filter(Boolean).map((s) => [s.profileId, s.startDate])
  );
}

/**
 * Format profile with ALL fields (combined format)
 * This creates a snapshot of profile data
 */
function formatProfileSnapshot(profile, subscriptionStartMap, batchType) {
  const contact = profile.contactInfo || {};
  const personal = profile.personalInfo || {};
  const professional = profile.professionalDetails || {};
  const cornMarket = profile.cornMarket || {};

  const fullName =
    [personal.forename, personal.surname].filter(Boolean).join(" ") || null;

  // Create snapshot with ALL fields (both new and graduate)
  return {
    profileId: profile._id,
    // Fields from "new" format
    membershipNo: profile.membershipNumber || null,
    fullName: fullName,
    addressLine1: contact.buildingOrHouse || null,
    addressLine2: contact.streetOrRoad || null,
    addressLine3: contact.areaOrTown || null,
    addressCity: contact.areaOrTown || null,
    addressCounty: contact.countyCityOrPostCode || null,
    addressPostcode: contact.eircode || null,
    email: contact.personalEmail || contact.workEmail || null,
    mobileNumber: contact.mobileNumber || null,
    newMember: batchType === "inmo-rewards",
    reward: cornMarket.inmoRewards || false,
    // Fields from "graduate" format
    membershipNumber: profile.membershipNumber || null,
    dateJoined: profile.firstJoinedDate || null,
    dateApplicationProcessed: profile.submissionDate || null,
    unionConsent: profile.preferences?.valueAddedServices || false,
    exclusiveDiscountsAndOffers:
      cornMarket.exclusiveDiscountsAndOffers || false,
    cornmarketMarketingOptIn: cornMarket.incomeProtectionScheme || false,
    workplace: professional.workLocation || null,
    payrollNumber: professional.payrollNo || null,
    grade: professional.grade || null,
    gender: personal.gender || null,
    surname: personal.surname || null,
    forenames: personal.forename || null,
    telephoneMobile: contact.mobileNumber || null,
    emailAddress: contact.personalEmail || contact.workEmail || null,
    address: contact.buildingOrHouse || null,
    addr2: contact.streetOrRoad || null,
    addr3: contact.areaOrTown || null,
    addr4: contact.countyCityOrPostCode || null,
    eircode: contact.eircode || null,
    // Common fields
    dateOfBirth: personal.dateOfBirth || null,
    joinDate: subscriptionStartMap.get(profile._id.toString()) || null,
  };
}

/**
 * Create a new batch and store profile snapshots
 */
async function createBatch(req, res, next) {
  try {
    if (req.user?.userType !== "CRM") {
      return next(
        AppError.badRequest("Only CRM users can access this endpoint")
      );
    }

    const { name, type, date } = req.body;
    const userId = req.user?.id || req.user?.sub || req.userId;

    if (!name || !name.trim()) {
      return next(AppError.badRequest("Batch name is required"));
    }

    // Validate type - use frontend types directly
    const validTypes = ["inmo-rewards", "new-graduate", "recruit-friend"];
    if (!validTypes.includes(type)) {
      return next(
        AppError.badRequest(
          "Type must be either 'inmo-rewards', 'new-graduate', or 'recruit-friend'"
        )
      );
    }

    if (!date) {
      return next(AppError.badRequest("Date is required"));
    }

    if (!userId) {
      return next(AppError.badRequest("User ID is required"));
    }

    // Build query based on frontend type
    let query = {
      batchId: null, // Only profiles not in any batch
    };

    if (type === "inmo-rewards") {
      query["preferences.valueAddedServices"] = true;
      query["additionalInformation.membershipStatus"] = "new";
      query["cornMarket.inmoRewards"] = true;
    } else if (type === "new-graduate") {
      query["preferences.valueAddedServices"] = true;
      query["additionalInformation.membershipStatus"] = "graduate";
      query.$or = [
        { "cornMarket.incomeProtectionScheme": true },
        { "cornMarket.exclusiveDiscountsAndOffers": true },
      ];
    } else if (type === "recruit-friend") {
      query["recruitmentDetails.confirmedRecruiterProfileId"] = { $ne: null };
    }

    // Find matching profiles with all needed fields
    const matchingProfiles = await Profile.find(query).lean();

    const profileIds = matchingProfiles.map((profile) => profile._id);
    let profileSnapshots = [];

    // Only fetch subscription data and create snapshots if profiles exist
    if (matchingProfiles.length > 0) {
      // Fetch subscription startDates for all profiles
      const profileIdStrings = profileIds.map((id) => id.toString());
      const subscriptionStartMap = await fetchSubscriptionStartDates(
        profileIdStrings,
        req.headers.authorization
      );

      // Create profile snapshots (all fields stored in batch)
      profileSnapshots = matchingProfiles.map((profile) =>
        formatProfileSnapshot(profile, subscriptionStartMap, type)
      );
    }

    // Create the batch with embedded profile data (even if empty)
    const batch = new Batch({
      name: name.trim(),
      type: type, // Store frontend type directly in database
      date: new Date(date),
      profileIds: profileIds,
      profiles: profileSnapshots, // Store snapshot of all profile fields
      createdBy: userId,
      isActive: true,
      isDeleted: false,
    });

    const savedBatch = await batch.save();

    // Update profiles with batchId (for reference, but batch has snapshot)
    if (profileIds.length > 0) {
      await Profile.updateMany(
        { _id: { $in: profileIds } },
        { $set: { batchId: savedBatch._id } }
      );
    }

    return res.status(201).json({
      success: true,
      message: "Batch created successfully",
      data: {
        ...savedBatch.toJSON(),
        profileCount: profileIds.length,
      },
    });
  } catch (error) {
    console.error("Error creating batch:", error);
    return next(
      AppError.internalServerError(error.message || "Failed to create batch")
    );
  }
}

/**
 * Get all batches (with pagination)
 */
async function getAllBatches(req, res, next) {
  try {
    if (req.user?.userType !== "CRM") {
      return next(
        AppError.badRequest("Only CRM users can access this endpoint")
      );
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const query = {
      isDeleted: false,
    };

    if (req.query.isActive !== undefined) {
      query.isActive = req.query.isActive === "true";
    }

    // Optional filter by type (use frontend types directly)
    if (req.query.type) {
      const validTypes = ["inmo-rewards", "new-graduate", "recruit-friend"];
      if (validTypes.includes(req.query.type)) {
        query.type = req.query.type;
      }
    }

    const [batches, total] = await Promise.all([
      Batch.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Batch.countDocuments(query),
    ]);

    // Get unique creator user IDs
    const creatorIds = [...new Set(batches.map((batch) => batch.createdBy).filter(Boolean))];
    
    // Fetch users by userId (createdBy is the userId string)
    const users = await User.find({
      userId: { $in: creatorIds },
      tenantId: req.tenantId || req.user?.tenantId,
    })
      .select("userId userFullName")
      .lean();

    // Create a map for quick lookup
    const userMap = new Map(users.map((user) => [user.userId, user.userFullName]));

    const batchesWithCount = batches.map((batch) => {
      const createdByName = userMap.get(batch.createdBy) || batch.createdBy;
      return {
        ...batch,
        profileCount: batch.profileIds ? batch.profileIds.length : 0,
        createdBy: createdByName,
      };
    });

    return res.success({
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      batches: batchesWithCount,
    });
  } catch (error) {
    console.error("Error fetching batches:", error);
    return next(
      AppError.internalServerError(error.message || "Failed to fetch batches")
    );
  }
}

/**
 * Get a single batch by ID
 * Returns profiles from batch snapshot (not from Profile collection)
 */
async function getBatchById(req, res, next) {
  try {
    if (req.user?.userType !== "CRM") {
      return next(
        AppError.badRequest("Only CRM users can access this endpoint")
      );
    }

    const { batchId } = req.params;

    const batch = await Batch.findOne({
      _id: batchId,
      isDeleted: false,
    }).lean();

    if (!batch) {
      return next(AppError.notFound("Batch not found"));
    }

    // Fetch creator user information
    let createdBy = batch.createdBy;
    if (batch.createdBy) {
      const creator = await User.findOne({
        userId: batch.createdBy,
        tenantId: req.tenantId || req.user?.tenantId,
      })
        .select("userFullName")
        .lean();
      
      if (creator && creator.userFullName) {
        createdBy = creator.userFullName;
      }
    }

    // Return profiles from batch snapshot (original data at creation time)
    // Filter fields based on batch type
    let formattedProfiles = batch.profiles || [];

    if (batch.type === "inmo-rewards") {
      // Return only "new" format fields
      formattedProfiles = formattedProfiles.map((p) => ({
        membershipNo: p.membershipNo,
        fullName: p.fullName,
        addressLine1: p.addressLine1,
        addressLine2: p.addressLine2,
        addressLine3: p.addressLine3,
        addressCity: p.addressCity,
        addressCounty: p.addressCounty,
        addressPostcode: p.addressPostcode,
        email: p.email,
        mobileNumber: p.mobileNumber,
        dateOfBirth: p.dateOfBirth,
        joinDate: p.joinDate,
        newMember: p.newMember,
        reward: p.reward,
      }));
    } else if (batch.type === "new-graduate") {
      // Return only "graduate" format fields
      formattedProfiles = formattedProfiles.map((p) => ({
        membershipNumber: p.membershipNumber,
        dateJoined: p.dateJoined,
        dateApplicationProcessed: p.dateApplicationProcessed,
        unionConsent: p.unionConsent,
        exclusiveDiscountsAndOffers: p.exclusiveDiscountsAndOffers,
        cornmarketMarketingOptIn: p.cornmarketMarketingOptIn,
        dateOfBirth: p.dateOfBirth,
        workplace: p.workplace,
        payrollNumber: p.payrollNumber,
        grade: p.grade,
        gender: p.gender,
        surname: p.surname,
        forenames: p.forenames,
        telephoneMobile: p.telephoneMobile,
        emailAddress: p.emailAddress,
        address: p.address,
        addr2: p.addr2,
        addr3: p.addr3,
        addr4: p.addr4,
        eircode: p.eircode,
        joinDate: p.joinDate,
      }));
    }

    return res.success({
      ...batch,
      profileCount: batch.profiles ? batch.profiles.length : 0,
      profiles: formattedProfiles,
      createdBy: createdBy,
    });
  } catch (error) {
    console.error("Error fetching batch:", error);
    return next(
      AppError.internalServerError(error.message || "Failed to fetch batch")
    );
  }
}

/**
 * Update a batch (name, date, isActive)
 */
async function updateBatch(req, res, next) {
  try {
    if (req.user?.userType !== "CRM") {
      return next(
        AppError.badRequest("Only CRM users can access this endpoint")
      );
    }

    const { batchId } = req.params;
    const { name, date, isActive } = req.body;

    const batch = await Batch.findOne({
      _id: batchId,
      isDeleted: false,
    });

    if (!batch) {
      return next(AppError.notFound("Batch not found"));
    }

    if (name !== undefined && name.trim()) {
      batch.name = name.trim();
    }
    if (date !== undefined) {
      batch.date = new Date(date);
    }
    if (typeof isActive === "boolean") {
      batch.isActive = isActive;
    }

    const updatedBatch = await batch.save();

    return res.success({
      ...updatedBatch.toJSON(),
      profileCount: updatedBatch.profileIds
        ? updatedBatch.profileIds.length
        : 0,
    });
  } catch (error) {
    console.error("Error updating batch:", error);
    return next(
      AppError.internalServerError(error.message || "Failed to update batch")
    );
  }
}

/**
 * Delete a batch (soft delete)
 */
async function deleteBatch(req, res, next) {
  try {
    if (req.user?.userType !== "CRM") {
      return next(
        AppError.badRequest("Only CRM users can access this endpoint")
      );
    }

    const { batchId } = req.params;

    const batch = await Batch.findOne({
      _id: batchId,
      isDeleted: false,
    });

    if (!batch) {
      return next(AppError.notFound("Batch not found"));
    }

    // Remove batchId from all profiles
    await Profile.updateMany({ batchId: batchId }, { $set: { batchId: null } });

    // Soft delete
    batch.isDeleted = true;
    batch.isActive = false;
    await batch.save();

    return res.success({
      message: "Batch deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting batch:", error);
    return next(
      AppError.internalServerError(error.message || "Failed to delete batch")
    );
  }
}

/**
 * Refresh batch profile IDs (re-fetch matching profiles and update snapshots)
 */
async function refreshBatch(req, res, next) {
  try {
    if (req.user?.userType !== "CRM") {
      return next(
        AppError.badRequest("Only CRM users can access this endpoint")
      );
    }

    const { batchId } = req.params;

    const batch = await Batch.findOne({
      _id: batchId,
      isDeleted: false,
    });

    if (!batch) {
      return next(AppError.notFound("Batch not found"));
    }

    // Build query based on batch type
    let query = {
      batchId: null, // Only profiles not in any batch
    };

    if (batch.type === "inmo-rewards") {
      query["preferences.valueAddedServices"] = true;
      query["additionalInformation.membershipStatus"] = "new";
      query["cornMarket.inmoRewards"] = true;
    } else if (batch.type === "new-graduate") {
      query["preferences.valueAddedServices"] = true;
      query["additionalInformation.membershipStatus"] = "graduate";
      query.$or = [
        { "cornMarket.incomeProtectionScheme": true },
        { "cornMarket.exclusiveDiscountsAndOffers": true },
      ];
    } else if (batch.type === "recruit-friend") {
      query["recruitmentDetails.confirmedRecruiterProfileId"] = { $ne: null };
    }

    // Find matching profiles with all needed fields
    const matchingProfiles = await Profile.find(query).lean();

    const profileIds = matchingProfiles.map((profile) => profile._id);

    // Remove batchId from old profiles
    await Profile.updateMany({ batchId: batchId }, { $set: { batchId: null } });

    let profileSnapshots = [];

    // Only fetch subscription data and create snapshots if profiles exist
    if (matchingProfiles.length > 0) {
      // Fetch subscription startDates
      const profileIdStrings = profileIds.map((id) => id.toString());
      const subscriptionStartMap = await fetchSubscriptionStartDates(
        profileIdStrings,
        req.headers.authorization
      );

      // Create new profile snapshots
      profileSnapshots = matchingProfiles.map((profile) =>
        formatProfileSnapshot(profile, subscriptionStartMap, batch.type)
      );
    }

    // Update batch with new profile IDs and snapshots
    batch.profileIds = profileIds;
    batch.profiles = profileSnapshots; // Update snapshots
    const updatedBatch = await batch.save();

    // Update all matching profiles with the batchId
    if (profileIds.length > 0) {
      await Profile.updateMany(
        { _id: { $in: profileIds } },
        { $set: { batchId: batchId } }
      );
    }

    return res.success({
      ...updatedBatch.toJSON(),
      profileCount: profileIds.length,
    });
  } catch (error) {
    console.error("Error refreshing batch:", error);
    return next(
      AppError.internalServerError(error.message || "Failed to refresh batch")
    );
  }
}

module.exports = {
  createBatch,
  getAllBatches,
  getBatchById,
  updateBatch,
  deleteBatch,
  refreshBatch,
};

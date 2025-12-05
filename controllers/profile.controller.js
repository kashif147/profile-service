const mongoose = require("mongoose");
const Profile = require("../models/profile.model.js");
const { AppError } = require("../errors/AppError");
const {
  normalizeEmail,
  pickPrimaryEmail,
} = require("../helpers/profileLookup.service.js");
const { extractUserAndCreatorContext } = require("../helpers/get.user.info.js");

const allowedUpdateFields = new Set([
  "personalInfo",
  "contactInfo",
  "professionalDetails",
  "subscriptionDetails",
  "preferences",
  "cornMarket",
  "additionalInformation",
  "recruitmentDetails",
  "membershipNumber",
  "normalizedEmail",
  "userId",
  "isActive",
  "deactivatedAt",
]);

function escapeRegex(value = "") {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickAllowedUpdates(payload = {}) {
  const result = {};

  for (const [key, value] of Object.entries(payload)) {
    if (!allowedUpdateFields.has(key)) continue;

    if (value === undefined) continue;

    result[key] = value;
  }

  if (result.normalizedEmail) {
    result.normalizedEmail = normalizeEmail(result.normalizedEmail);
  }

  return result;
}

async function getAllProfiles(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const skip = (page - 1) * limit;

    const query = { tenantId };

    const [profiles, total] = await Promise.all([
      Profile.find(query)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Profile.countDocuments(query),
    ]);

    return res.success({
      count: profiles.length,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      results: profiles,
    });
  } catch (error) {
    return next(
      AppError.internalServerError(error.message || "Failed to fetch profiles")
    );
  }
}

async function searchProfiles(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const searchTerm = (req.query.q || req.query.query || "").trim();

    if (!searchTerm) {
      return next(AppError.badRequest("Search query is required"));
    }

    const conditions = [];
    const regex = new RegExp(escapeRegex(searchTerm), "i");

    conditions.push({ membershipNumber: searchTerm });

    const normalized = normalizeEmail(searchTerm);
    if (normalized) {
      conditions.push({ normalizedEmail: normalized });
      conditions.push({ "contactInfo.personalEmail": regex });
      conditions.push({ "contactInfo.workEmail": regex });
      conditions.push({ "contactInfo.preferredEmail": regex });
    }

    conditions.push({ "personalInfo.forename": regex });
    conditions.push({ "personalInfo.surname": regex });
    conditions.push({
      $expr: {
        $regexMatch: {
          input: {
            $concat: [
              { $ifNull: ["$personalInfo.forename", ""] },
              " ",
              { $ifNull: ["$personalInfo.surname", ""] },
            ],
          },
          regex: escapeRegex(searchTerm),
          options: "i",
        },
      },
    });

    conditions.push({ "contactInfo.mobileNumber": regex });
    conditions.push({ "contactInfo.telephoneNumber": regex });

    const digitsOnly = searchTerm.replace(/\D/g, "");
    if (digitsOnly.length >= 4) {
      const digitsRegex = new RegExp(escapeRegex(digitsOnly));
      conditions.push({
        "contactInfo.mobileNumber": { $regex: digitsRegex },
      });
      conditions.push({
        "contactInfo.telephoneNumber": { $regex: digitsRegex },
      });
    }

    const query = {
      tenantId,
      $or: conditions,
    };

    const results = await Profile.find(query)
      .sort({ updatedAt: -1 })
      .limit(25)
      .lean();

    return res.success({
      count: results.length,
      results,
    });
  } catch (error) {
    return next(
      AppError.internalServerError(error.message || "Failed to search profiles")
    );
  }
}

async function getProfileById(req, res, next) {
  try {
    const { profileId } = req.params;
    const tenantId = req.tenantId;

    if (!mongoose.Types.ObjectId.isValid(profileId)) {
      return next(AppError.badRequest("Invalid profileId"));
    }

    const profile = await Profile.findOne({
      _id: profileId,
      tenantId,
    }).lean();

    if (!profile) {
      return res.status(200).json({
        data: null,
        message: "Not found",
      });
    }

    return res.success(profile);
  } catch (error) {
    return next(
      AppError.internalServerError(error.message || "Failed to fetch profile")
    );
  }
}

async function updateProfile(req, res, next) {
  try {
    const { profileId } = req.params;
    const tenantId = req.tenantId;

    if (!mongoose.Types.ObjectId.isValid(profileId)) {
      return next(AppError.badRequest("Invalid profileId"));
    }

    const updates = pickAllowedUpdates(req.body);

    if (Object.keys(updates).length === 0) {
      return next(AppError.badRequest("No valid fields provided for update"));
    }

    const profile = await Profile.findOne({
      _id: profileId,
      tenantId,
    });

    if (!profile) {
      return next(AppError.notFound("Profile not found"));
    }

    // Prevent tenant updates
    if (updates.tenantId) {
      delete updates.tenantId;
    }

    if (updates.isActive === true) {
      updates.deactivatedAt = null;
    }

    // Update normalizedEmail if contactInfo is being updated
    if (updates.contactInfo) {
      const existingContactInfo = profile.contactInfo?.toObject
        ? profile.contactInfo.toObject()
        : profile.contactInfo || {};
      const contactInfo = { ...existingContactInfo, ...updates.contactInfo };
      const primaryEmail = pickPrimaryEmail(contactInfo);
      if (primaryEmail) {
        updates.normalizedEmail = normalizeEmail(primaryEmail);
      }
    }

    // Handle consent synchronization with individual consent fields
    if (updates.preferences) {
      const existingPreferences = profile.preferences?.toObject
        ? profile.preferences.toObject()
        : profile.preferences || {};
      const preferences = { ...existingPreferences, ...updates.preferences };

      // Check if consent is being explicitly set in the request
      if ("consent" in updates.preferences && typeof updates.preferences.consent === "boolean") {
        const consentValue = updates.preferences.consent;
        const consentFields = ["smsConsent", "emailConsent", "postalConsent", "appConsent"];

        // Only set individual consent fields if they're not explicitly provided in the request
        for (const field of consentFields) {
          if (!(field in updates.preferences)) {
            preferences[field] = consentValue;
          }
        }
      }

      updates.preferences = preferences;
    }

    profile.set(updates);

    await profile.save();

    return res.success(profile.toObject());
  } catch (error) {
    if (error.name === "ValidationError") {
      return next(AppError.badRequest(error.message));
    }
    if (error.code === 11000) {
      return next(
        AppError.conflict("Duplicate value for unique field", {
          duplicateKey: error.keyValue,
        })
      );
    }
    return next(
      AppError.internalServerError(error.message || "Failed to update profile")
    );
  }
}

async function softDeleteProfile(req, res, next) {
  try {
    const { profileId } = req.params;
    const tenantId = req.tenantId;

    if (!mongoose.Types.ObjectId.isValid(profileId)) {
      return next(AppError.badRequest("Invalid profileId"));
    }

    const profile = await Profile.findOne({
      _id: profileId,
      tenantId,
    });

    if (!profile) {
      return next(AppError.notFound("Profile not found"));
    }

    profile.isActive = false;
    profile.deactivatedAt = new Date();

    await profile.save();

    return res.success({
      profileId: profile._id,
      isActive: profile.isActive,
      deactivatedAt: profile.deactivatedAt,
    });
  } catch (error) {
    return next(
      AppError.internalServerError(error.message || "Failed to delete profile")
    );
  }
}

/**
 * Get profile ID and membership number for portal user
 * GET /api/profile/me
 * Returns: { profileId, membershipNumber }
 */
async function getMyProfile(req, res, next) {
  try {
    const { userId, userType } = extractUserAndCreatorContext(req);

    // Only allow PORTAL users
    if (userType !== "PORTAL") {
      return next(
        AppError.forbidden("This endpoint is only available for Portal users")
      );
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

    // Find profile by userId
    const profile = await Profile.findOne({
      userId: userIdObjectId,
    })
      .select("_id membershipNumber")
      .lean();

    if (!profile) {
      return res.status(200).json({
        data: null,
        message: "Profile not found",
      });
    }

    return res.success({
      profileId: profile._id,
      membershipNumber: profile.membershipNumber,
    });
  } catch (error) {
    console.error("ProfileController [getMyProfile] Error:", error);
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch profile information"
      )
    );
  }
}

module.exports = {
  getAllProfiles,
  searchProfiles,
  getProfileById,
  updateProfile,
  softDeleteProfile,
  getMyProfile,
};

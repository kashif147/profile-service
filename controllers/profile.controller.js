const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const Profile = require("../models/profile.model.js");
const Subscription = require("../models/subscription.model.js");
const { AppError } = require("../errors/AppError");
const {
  normalizeEmail,
  pickPrimaryEmail,
} = require("../helpers/profileLookup.service.js");
const { extractUserAndCreatorContext } = require("../helpers/get.user.info.js");
const joischemas = require("../validation/index.js");
const personalDetailsService = require("../services/personal.details.service.js");
const professionalDetailsService = require("../services/professional.details.service.js");
const subscriptionDetailsService = require("../services/subscription.details.service.js");
const aggregatedUserDetailsController = require("./aggregated.user.details.controller.js");
const {
  enrichWithSubscriptionService,
} = require("../services/aggregated.user.details.service.js");
const {
  fetchCurrentSubscriptionByProfileId,
} = require("../services/subscription.service.client.js");

/**
 * Apply derived fields (age, fullAddress, date conversions) to the payload.
 * This ensures the backend always owns these calculations.
 */
function applyDerivedFields(data = {}) {
  // Age calculation and date conversion
  if (data.personalInfo?.dateOfBirth) {
    let dob;

    // If it's already a Date object (from Joi.date().iso())
    if (data.personalInfo.dateOfBirth instanceof Date) {
      dob = data.personalInfo.dateOfBirth;
    } else {
      // If it's a string, check format
      const dateStr = data.personalInfo.dateOfBirth.toString();
      if (dateStr.includes("/")) {
        dob = new Date(dateStr.split("/").reverse().join("-"));
      } else {
        // ISO format
        dob = new Date(dateStr);
      }
    }

    data.personalInfo.dateOfBirth = dob;
    data.personalInfo.age = new Date().getFullYear() - dob.getFullYear();
  }

  // Convert deceasedDate if present
  if (data.personalInfo?.deceasedDate) {
    let deceasedDate;

    // If it's already a Date object (from Joi.date().iso())
    if (data.personalInfo.deceasedDate instanceof Date) {
      deceasedDate = data.personalInfo.deceasedDate;
    } else {
      // If it's a string, check format
      const dateStr = data.personalInfo.deceasedDate.toString();
      if (dateStr.includes("/")) {
        deceasedDate = new Date(dateStr.split("/").reverse().join("-"));
      } else {
        // ISO format
        deceasedDate = new Date(dateStr);
      }
    }

    data.personalInfo.deceasedDate = deceasedDate;
  }

  // Address formatting
  if (data.contactInfo) {
    const parts = [];
    
    if (data.contactInfo.buildingOrHouse?.trim()) {
      parts.push(data.contactInfo.buildingOrHouse.trim());
    }
    
    if (data.contactInfo.streetOrRoad?.trim()) {
      parts.push(data.contactInfo.streetOrRoad.trim());
    }
    
    if (data.contactInfo.areaOrTown?.trim()) {
      parts.push(data.contactInfo.areaOrTown.trim());
    }
    
    if (data.contactInfo.countyCityOrPostCode?.trim()) {
      parts.push(data.contactInfo.countyCityOrPostCode.trim());
    }
    
    if (data.contactInfo.country?.trim()) {
      parts.push(data.contactInfo.country.trim());
    }
    
    data.contactInfo.fullAddress = parts.join(", ");
  }
}

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
        .populate("crmUserId", "userFullName")
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Profile.countDocuments(query),
    ]);

    const profilesToEnrich = profiles.filter((p) => p.currentSubscriptionId);
    const subMap = new Map();
    if (profilesToEnrich.length > 0) {
      const subs = await Promise.all(
        profilesToEnrich.map((p) =>
          fetchCurrentSubscriptionByProfileId(
            p._id?.toString(),
            p.tenantId ?? tenantId,
            req,
            p.currentSubscriptionId?.toString?.() ?? p.currentSubscriptionId
          ).then((sub) => ({ profileId: p._id.toString(), sub }))
        )
      );
      subs.forEach(({ profileId, sub }) => {
        if (sub) subMap.set(profileId, sub);
      });
    }

    const enriched = profiles.map((p) => {
      const sub = subMap.get(p._id?.toString()) ?? null;
      return {
        ...p,
        membershipCategory: sub?.membershipCategory ?? null,
        ...(sub && {
          _subscriptionService: {
            paymentType: sub.paymentType ?? null,
            paymentFrequency: sub.paymentFrequency ?? null,
            startDate: sub.startDate ?? null,
            endDate: sub.endDate ?? null,
          },
        }),
      };
    });

    return res.success({
      count: enriched.length,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      results: enriched,
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

    // Membership number: match from first 3 characters (starts with)
    if (searchTerm.length >= 3) {
      const membershipNumberRegex = new RegExp(
        `^${escapeRegex(searchTerm)}`,
        "i"
      );
      conditions.push({ membershipNumber: membershipNumberRegex });
    }

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
      .populate("crmUserId", "userFullName")
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

    // If request hit this route with literal path (e.g. gateway rewrote URL or trailing slash), delegate to aggregated-user-details
    const param = (profileId || "").replace(/\/$/, "");
    if (param === "aggregated-user-details") {
      return aggregatedUserDetailsController.getAggregatedUserDetails(
        req,
        res,
        next
      );
    }

    if (!mongoose.Types.ObjectId.isValid(profileId)) {
      return next(AppError.badRequest("Invalid profileId"));
    }

    const profile = await Profile.findOne({
      _id: profileId,
      tenantId,
    })
      .populate("crmUserId", "userFullName")
      .lean();

    if (!profile) {
      return res.status(200).json({
        data: null,
        message: "Not found",
      });
    }

    let sub = null;
    if (profile.currentSubscriptionId) {
      const subId =
        profile.currentSubscriptionId?.toString?.() ??
        profile.currentSubscriptionId;
      sub = await fetchCurrentSubscriptionByProfileId(
        profileId,
        profile.tenantId ?? tenantId,
        req,
        subId
      );
    }
    const enriched = {
      ...profile,
      membershipCategory: sub?.membershipCategory ?? null,
      ...(sub && {
        _subscriptionService: {
          paymentType: sub.paymentType ?? null,
          paymentFrequency: sub.paymentFrequency ?? null,
          startDate: sub.startDate ?? null,
          endDate: sub.endDate ?? null,
        },
      }),
    };
    return res.success(enriched);
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
    })
      .populate("crmUserId", "userFullName");

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
      if (
        "consent" in updates.preferences &&
        typeof updates.preferences.consent === "boolean"
      ) {
        const consentValue = updates.preferences.consent;
        const consentFields = [
          "smsConsent",
          "emailConsent",
          "postalConsent",
          "appConsent",
        ];

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

    const populatedProfile = await Profile.findById(profile._id)
      .populate("crmUserId", "userFullName")
      .lean();

    return res.success(populatedProfile);
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
    })
      .populate("crmUserId", "userFullName");

    if (!profile) {
      return next(AppError.notFound("Profile not found"));
    }

    profile.isActive = false;
    profile.deactivatedAt = new Date();

    await profile.save();

    const populatedProfile = await Profile.findById(profile._id)
      .populate("crmUserId", "userFullName")
      .lean();

    return res.success({
      profileId: profile._id,
      isActive: profile.isActive,
      deactivatedAt: profile.deactivatedAt,
      crmUserId: populatedProfile.crmUserId,
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
    const { userId, userType, tenantId } = extractUserAndCreatorContext(req);

    console.log("=== getMyProfile DEBUG ===");
    console.log("Extracted context:", { userId, userType, tenantId });
    console.log("req.user:", req.user);

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

    console.log("Looking up profile with userId:", userIdObjectId.toString());

    // Find profile by userId
    const profile = await Profile.findOne({
      userId: userIdObjectId,
    })
      .select("_id membershipNumber userId normalizedEmail")
      .lean();

    console.log("Profile found by userId:", profile);

    if (!profile) {
      // Try to find by email from User table as fallback
      const User = require("../models/user.model.js");
      const user = await User.findOne({
        userId: userId,
        tenantId,
        userType: "PORTAL",
        isActive: true,
      }).lean();

      console.log("User found in User table:", user);

      if (user?.userEmail) {
        const profileByEmail = await Profile.findOne({
          tenantId,
          normalizedEmail: user.userEmail.toLowerCase(),
          isActive: true,
        })
          .select("_id membershipNumber userId normalizedEmail")
          .lean();

        console.log("Profile found by email:", profileByEmail);

        if (profileByEmail) {
          // Link userId to profile for future requests
          await Profile.updateOne(
            { _id: profileByEmail._id },
            { $set: { userId: userIdObjectId } }
          );

          console.log(
            `✅ Auto-linked userId ${userId} to profile ${profileByEmail._id}`
          );

          return res.success({
            profileId: profileByEmail._id,
            membershipNumber: profileByEmail.membershipNumber,
          });
        }
      }

      console.log("No profile found by userId or email");

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

async function updateMyProfile(req, res, next) {
  try {
    const { userId, userType } = extractUserAndCreatorContext(req);

    if (userType !== "PORTAL") {
      return next(AppError.forbidden("Access denied. Only for PORTAL users."));
    }

    if (!userId) {
      return next(
        AppError.badRequest(
          "User ID is required. Please ensure you are properly authenticated."
        )
      );
    }

    let userIdObjectId;
    if (mongoose.Types.ObjectId.isValid(userId)) {
      userIdObjectId = new mongoose.Types.ObjectId(userId);
    } else {
      return next(AppError.badRequest("Invalid user ID format"));
    }

    const validatedData = await joischemas.profile_update.validateAsync(
      req.body
    );

    const profile = await Profile.findOne({
      userId: userIdObjectId,
    });

    if (!profile) {
      return next(AppError.notFound("Profile not found"));
    }

    // Merge existing data with new data
    const updates = {
      personalInfo: {
        ...(profile.personalInfo?.toObject?.() || profile.personalInfo || {}),
        ...validatedData.personalInfo,
      },
      contactInfo: {
        ...(profile.contactInfo?.toObject?.() || profile.contactInfo || {}),
        ...validatedData.contactInfo,
      },
      preferences: {
        ...(profile.preferences?.toObject?.() || profile.preferences || {}),
        ...validatedData.preferences,
      },
    };

    // Age and fullAddress are automatically calculated
    applyDerivedFields(updates);

    // Sync consent - if user sends consent (true/false)
    if (validatedData.preferences?.consent !== undefined) {
      updates.preferences.consent = validatedData.preferences.consent;
    }

    // Update normalizedEmail if email changed
    if (validatedData.contactInfo) {
      const primaryEmail = pickPrimaryEmail(updates.contactInfo);
      if (primaryEmail) updates.normalizedEmail = normalizeEmail(primaryEmail);
    }

    profile.set(updates);
    await profile.save();

    const populatedProfile = await Profile.findById(profile._id)
      .populate("crmUserId", "userFullName")
      .lean();

    return res.success(populatedProfile);
  } catch (error) {
    console.error("ProfileController [updateMyProfile] Error:", error);
    if (error.isJoi)
      return next(AppError.badRequest("Validation error: " + error.message));
    if (error.name === "ValidationError")
      return next(AppError.badRequest(error.message));
    if (error.code === 11000)
      return next(
        AppError.conflict("Duplicate value for unique field", {
          duplicateKey: error.keyValue,
        })
      );
    if (error.message === "Profile not found")
      return next(AppError.notFound("Profile not found"));
    return next(
      AppError.internalServerError(error.message || "Failed to update profile")
    );
  }
}

async function getCornMarketNew(req, res, next) {
  try {
    const { userType } = extractUserAndCreatorContext(req);

    // Only allow CRM users
    if (userType !== "CRM") {
      return next(
        AppError.forbidden("This endpoint is only available for CRM users")
      );
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const skip = (page - 1) * limit;

    // Find subscriptions with membershipStatus = "new"
    const subscriptions = await Subscription.find({
      "subscriptionDetails.membershipStatus": "new",
      deleted: false,
      isActive: true,
    })
      .select("userId")
      .lean();

    // Extract unique userIds
    const userIds = [
      ...new Set(
        subscriptions
          .map((sub) => sub.userId)
          .filter((id) => id !== null && id !== undefined)
      ),
    ];

    if (userIds.length === 0) {
      return res.success({
        count: 0,
        total: 0,
        page,
        limit,
        totalPages: 0,
        results: [],
      });
    }

    // Find profiles matching these userIds
    const query = {
      userId: { $in: userIds },
    };

    const [profiles, total] = await Promise.all([
      Profile.find(query)
        .populate("crmUserId", "userFullName")
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
      AppError.internalServerError(
        error.message || "Failed to fetch corn market new profiles"
      )
    );
  }
}

async function getCornMarketGraduate(req, res, next) {
  try {
    const { userType } = extractUserAndCreatorContext(req);

    // Only allow CRM users
    if (userType !== "CRM") {
      return next(
        AppError.forbidden("This endpoint is only available for CRM users")
      );
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const skip = (page - 1) * limit;

    // Find subscriptions with membershipStatus = "graduate"
    const subscriptions = await Subscription.find({
      "subscriptionDetails.membershipStatus": "graduate",
      deleted: false,
      isActive: true,
    })
      .select("userId")
      .lean();

    // Extract unique userIds
    const userIds = [
      ...new Set(
        subscriptions
          .map((sub) => sub.userId)
          .filter((id) => id !== null && id !== undefined)
      ),
    ];

    if (userIds.length === 0) {
      return res.success({
        count: 0,
        total: 0,
        page,
        limit,
        totalPages: 0,
        results: [],
      });
    }

    // Find profiles matching these userIds
    const query = {
      userId: { $in: userIds },
    };

    const [profiles, total] = await Promise.all([
      Profile.find(query)
        .populate("crmUserId", "userFullName")
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
      AppError.internalServerError(
        error.message || "Failed to fetch corn market graduate profiles"
      )
    );
  }
}

/**
 * Check if profile exists with given email and return basic profile details
 * Requires authentication (CRM or Portal users allowed)
 */
async function checkEmailExists(req, res, next) {
  try {
    const { email } = req.query;

    if (!email) {
      return next(AppError.badRequest("Email is required"));
    }

    // Validate email format - must contain @ symbol
    if (typeof email !== "string" || !email.includes("@")) {
      return next(AppError.badRequest("Invalid email format. Email must contain @ symbol"));
    }

    // Normalize email (same as when profile is created)
    // Converts to lowercase and trims whitespace
    // Example: "John.Doe@EXAMPLE.COM" -> "john.doe@example.com"
    const normalizedEmail = normalizeEmail(email);

    // Check if profile exists by normalizedEmail (searches across all tenants)
    const existingProfile = await Profile.findOne({
      normalizedEmail: normalizedEmail,
    }).lean();

    if (existingProfile) {
      // Return basic profile details
      return res.success({
        exists: true,
        message: "Profile with this email already exists",
        profile: {
          profileId: existingProfile._id,
          membershipNumber: existingProfile.membershipNumber,
          isActive: existingProfile.isActive,
          personalInfo: {
            title: existingProfile.personalInfo?.title,
            forename: existingProfile.personalInfo?.forename,
            surname: existingProfile.personalInfo?.surname,
            dateOfBirth: existingProfile.personalInfo?.dateOfBirth,
            age: existingProfile.personalInfo?.age,
            gender: existingProfile.personalInfo?.gender,
          },
          contactInfo: {
            mobileNumber: existingProfile.contactInfo?.mobileNumber,
            telephoneNumber: existingProfile.contactInfo?.telephoneNumber,
            preferredEmail: existingProfile.contactInfo?.preferredEmail,
            personalEmail: existingProfile.contactInfo?.personalEmail,
            workEmail: existingProfile.contactInfo?.workEmail,
            fullAddress: existingProfile.contactInfo?.fullAddress,
            country: existingProfile.contactInfo?.country,
          },
          professionalDetails: {
            workLocation: existingProfile.professionalDetails?.workLocation,
            branch: existingProfile.professionalDetails?.branch,
            grade: existingProfile.professionalDetails?.grade,
          },
          submissionDate: existingProfile.submissionDate,
          firstJoinedDate: existingProfile.firstJoinedDate,
        },
      });
    }

    return res.success({
      exists: false,
      message: "No profile with this email exists",
      profile: null,
    });
  } catch (error) {
    console.error("ProfileController [checkEmailExists] Error:", error);
    return next(
      AppError.internalServerError(
        error.message || "Failed to check email existence"
      )
    );
  }
}

/**
 * Get personal details for the logged-in PORTAL user
 * GET /api/profile/my-personal-details
 * Returns: Personal details for the user
 */
async function getMyPersonalDetails(req, res, next) {
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

    const personalDetails = await personalDetailsService.getMyPersonalDetails(
      userId,
      tenantId
    );

    if (!personalDetails) {
      return res.status(200).json({
        data: null,
        message: "Personal details not found",
      });
    }

    return res.success(personalDetails);
  } catch (error) {
    console.error("ProfileController [getMyPersonalDetails] Error:", error);
    if (error.message === "Personal details not found") {
      return res.status(200).json({
        data: null,
        message: "Personal details not found",
      });
    }
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch personal details"
      )
    );
  }
}

/**
 * Get professional details for the logged-in PORTAL user
 * GET /api/profile/my-professional-details
 * Returns: Professional details for the user
 */
async function getMyProfessionalDetails(req, res, next) {
  try {
    const { userId, userType, tenantId } = extractUserAndCreatorContext(req);

    // Only allow PORTAL users
    if (userType !== "PORTAL") {
      return next(
        AppError.forbidden("This endpoint is only available for Portal users")
      );
    }

    if (!userId) {
      return next(AppError.badRequest("User ID is required"));
    }

    const professionalDetails =
      await professionalDetailsService.getMyProfessionalDetails(
        userId,
        tenantId
      );

    if (!professionalDetails) {
      return res.status(200).json({
        data: null,
        message: "Professional details not found",
      });
    }

    return res.success(professionalDetails);
  } catch (error) {
    console.error("ProfileController [getMyProfessionalDetails] Error:", error);
    if (error.message === "Professional details not found") {
      return res.status(200).json({
        data: null,
        message: "Professional details not found",
      });
    }
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch professional details"
      )
    );
  }
}

/**
 * Get subscription details for the logged-in PORTAL user
 * GET /api/profile/my-subscription-details
 * Returns: Subscription details for the user
 */
async function getMySubscriptionDetails(req, res, next) {
  try {
    const { userId, userType, tenantId } = extractUserAndCreatorContext(req);

    // Only allow PORTAL users
    if (userType !== "PORTAL") {
      return next(
        AppError.forbidden("This endpoint is only available for Portal users")
      );
    }

    if (!userId) {
      return next(AppError.badRequest("User ID is required"));
    }

    let subscriptionDetails =
      await subscriptionDetailsService.getMySubscriptionDetails(
        userId,
        tenantId
      );

    const subResult = { personalDetails: null, subscriptionDetails };
    await enrichWithSubscriptionService(subResult, req);

    if (!subResult.subscriptionDetails) {
      return res.status(200).json({
        data: null,
        message: "Subscription details not found",
      });
    }

    return res.success(subResult.subscriptionDetails);
  } catch (error) {
    console.error("ProfileController [getMySubscriptionDetails] Error:", error);
    if (error.message === "Subscription details not found") {
      return res.status(200).json({
        data: null,
        message: "Subscription details not found",
      });
    }
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch subscription details"
      )
    );
  }
}

/**
 * Get all details (personal, professional, subscription) for the logged-in PORTAL user
 * GET /api/profile/my-details
 * Returns: Combined personal, professional, and subscription details
 */
async function getMyAllDetails(req, res, next) {
  try {
    const { userId, userType, tenantId } = extractUserAndCreatorContext(req);

    // Only allow PORTAL users
    if (userType !== "PORTAL") {
      return next(
        AppError.forbidden("This endpoint is only available for Portal users")
      );
    }

    if (!userId) {
      return next(AppError.badRequest("User ID is required"));
    }

    // Fetch all details in parallel
    const [personalDetails, professionalDetails, subscriptionDetails] =
      await Promise.allSettled([
        personalDetailsService.getMyPersonalDetails(userId, tenantId),
        professionalDetailsService.getMyProfessionalDetails(userId, tenantId),
        subscriptionDetailsService.getMySubscriptionDetails(userId, tenantId),
      ]);

    const result = {
      personalDetails:
        personalDetails.status === "fulfilled"
          ? personalDetails.value
          : null,
      professionalDetails:
        professionalDetails.status === "fulfilled"
          ? professionalDetails.value
          : null,
      subscriptionDetails:
        subscriptionDetails.status === "fulfilled"
          ? subscriptionDetails.value
          : null,
    };

    await enrichWithSubscriptionService(result, req);

    if (
      !result.personalDetails &&
      !result.professionalDetails &&
      !result.subscriptionDetails
    ) {
      return res.status(200).json({
        data: null,
        message: "No details found for this user",
      });
    }

    return res.success(result);
  } catch (error) {
    console.error("ProfileController [getMyAllDetails] Error:", error);
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch user details"
      )
    );
  }
}

/**
 * Batch endpoint for gateway aggregation: get profiles by profile IDs.
 * POST /api/profile/batch
 * Body: { profileIds: string[] }
 * Returns: { data: profile[] } - array of full profile documents for aggregation.
 * Auth: JWT (Authorization header) OR internal service call (x-internal-request: true + x-tenant-id).
 */
async function getProfilesBatch(req, res, next) {
  try {
    // Accept either JWT or internal request (when gateway doesn't forward JWT to profile-service)
    const isInternalRequest =
      req.headers["x-internal-request"] === "true" ||
      req.headers["x-internal-request"] === "1";
    const tenantIdHeader = req.headers["x-tenant-id"];

    let hasValidJWT = false;
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        req.userId = decoded.sub || decoded.id;
        req.tenantId = decoded.tenantId || decoded.tid || decoded.extension_tenantId;
        hasValidJWT = true;
      } catch (err) {
        // JWT invalid; will allow if internal header present
      }
    }

    if (!hasValidJWT) {
      if (isInternalRequest && tenantIdHeader) {
        req.tenantId = tenantIdHeader;
        req.user = req.user || { tenantId: tenantIdHeader };
      } else {
        return res.status(401).json({
          success: false,
          message:
            "Batch endpoint requires Authorization (Bearer) or internal request (x-internal-request: true and x-tenant-id)",
        });
      }
    }

    // Accept profileIds from POST body or GET query (gateway-safe when proxy strips body or converts to GET)
    let profileIds = req.body?.profileIds;
    if (!profileIds || !Array.isArray(profileIds)) {
      const q = req.query?.profileIds;
      profileIds = typeof q === "string"
        ? q.split(",").map((s) => s.trim()).filter(Boolean)
        : Array.isArray(q)
          ? q.filter((id) => id != null && String(id).trim())
          : [];
    }

    if (!profileIds || profileIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "profileIds array is required and must not be empty (body.profileIds or query.profileIds)",
      });
    }

    const objectIds = profileIds
      .map((id) => {
        try {
          if (mongoose.Types.ObjectId.isValid(id)) {
            return new mongoose.Types.ObjectId(id);
          }
          return null;
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);

    if (objectIds.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const query = { _id: { $in: objectIds } };
    if (req.tenantId) {
      query.tenantId = req.tenantId;
    }
    const profiles = await Profile.find(query).lean();

    return res.status(200).json({
      success: true,
      data: profiles,
    });
  } catch (error) {
    console.error("ProfileController [getProfilesBatch] Error:", error);
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch profiles by IDs"
      )
    );
  }
}

// Internal endpoint: Get profile by email and tenantId (for membership check by user-service)
async function getProfileByEmailInternal(req, res, next) {
  try {
    const isInternalRequest =
      req.headers["x-internal-request"] === "true" ||
      req.headers["x-internal-request"] === "1";

    if (!isInternalRequest) {
      return res.status(403).json({
        success: false,
        message: "Internal endpoint: x-internal-request header required",
      });
    }

    const { email, tenantId } = req.query;
    if (!email || !tenantId) {
      return res.status(400).json({
        success: false,
        message: "email and tenantId query params are required",
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const profile = await Profile.findOne({
      tenantId,
      normalizedEmail,
      isActive: { $ne: false },
    })
      .select("_id")
      .lean();

    return res.status(200).json({
      success: true,
      data: profile ? { profileId: profile._id.toString() } : null,
    });
  } catch (error) {
    console.error("ProfileController [getProfileByEmailInternal] Error:", error);
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch profile by email"
      )
    );
  }
}

// Internal endpoint: Get profiles by user IDs (for service-to-service calls)
async function getProfilesByUserIds(req, res, next) {
  try {
    // Accept either JWT token OR internal request header
    const isInternalRequest =
      req.headers["x-internal-request"] === "true" ||
      req.headers["x-internal-request"] === "1";
    
    // Manually validate JWT token if present (since route is before authenticate middleware)
    let hasValidJWT = false;
    const authHeader = req.headers.authorization || req.headers.Authorization;
    
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Set user context if JWT is valid
        req.user = decoded;
        req.userId = decoded.sub || decoded.id;
        req.tenantId = decoded.tenantId || decoded.tid || decoded.extension_tenantId;
        hasValidJWT = true;
      } catch (error) {
        // JWT validation failed, but we'll still allow if internal header is present
        console.warn("JWT validation failed for internal endpoint:", error.message);
      }
    }

    // If neither JWT token (valid) nor internal header is present, reject
    if (!hasValidJWT && !isInternalRequest) {
      return res.status(403).json({
        success: false,
        message:
          "This endpoint requires either a valid JWT token (Authorization header) or internal request header (x-internal-request)",
      });
    }

    const { userIds } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "userIds array is required and must not be empty",
      });
    }

    // Convert userIds to ObjectIds (Profile.userId is ObjectId, but FCMToken.userId is String)
    // Try to convert each userId to ObjectId, filter out invalid ones
    const objectIdUserIds = userIds
      .map((id) => {
        try {
          // If already ObjectId, return as is
          if (mongoose.Types.ObjectId.isValid(id)) {
            return new mongoose.Types.ObjectId(id);
          }
          return null;
        } catch (error) {
          return null;
        }
      })
      .filter(Boolean);

    if (objectIdUserIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: {},
      });
    }

    // Fetch profiles by userIds (using ObjectIds)
    const profiles = await Profile.find({
      userId: { $in: objectIdUserIds },
    })
      .select(
        "userId tenantId personalInfo contactInfo membershipNumber isActive normalizedEmail"
      )
      .lean();

    // Create a map of userId -> profile for easy lookup
    // Map each profile to all possible userId formats (ObjectId string and original string)
    const profilesByUserId = {};
    
    profiles.forEach((profile) => {
      if (profile.userId) {
        const profileUserIdStr = String(profile.userId);
        
        // Find the original userId from the request that matches this profile's userId
        // This handles the case where FCMToken.userId is a string but Profile.userId is ObjectId
        const matchingOriginalId = userIds.find((id) => {
          const originalIdStr = String(id);
          // Compare both as strings - MongoDB ObjectId comparison works with string comparison
          return originalIdStr === profileUserIdStr;
        });
        
        // Map using the original userId string from the request (so notification-service can find it)
        if (matchingOriginalId) {
          profilesByUserId[String(matchingOriginalId)] = profile;
        }
        // Also map using the ObjectId string format as fallback
        profilesByUserId[profileUserIdStr] = profile;
      }
    });
    
    console.log("Profile lookup results:", {
      requestedUserIds: userIds,
      profilesFound: profiles.length,
      mappedUserIds: Object.keys(profilesByUserId),
    });

    return res.status(200).json({
      success: true,
      data: profilesByUserId,
    });
  } catch (error) {
    console.error("ProfileController [getProfilesByUserIds] Error:", error);
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch profiles by user IDs"
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
  updateMyProfile,
  getCornMarketNew,
  getCornMarketGraduate,
  checkEmailExists,
  getMyPersonalDetails,
  getMyProfessionalDetails,
  getMySubscriptionDetails,
  getMyAllDetails,
  getProfilesBatch,
  getProfilesByUserIds,
  getProfileByEmailInternal,
};

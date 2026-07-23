const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const Profile = require("../models/profile.model.js");
const Subscription = require("../models/subscription.model.js");
const User = require("../models/user.model.js");
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
const applicationFilterTemplateService = require("../services/application.filter.template.service.js");
const profileFilterHandler = require("../handlers/profile.filter.handler.js");
const {
  stampPersonalInfoFullName,
  enrichPersonalInfoFullNameOnDocument,
  enrichPersonalInfoFullNameOnDocuments,
} = require("../helpers/personal.info.fullName.js");
const {
  publishProfileAfterUpdateOne,
} = require("../services/profile.audit.publisher.js");
const bizLogger = require("../config/bizLogger.js");

function objectIdCandidate(value) {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
}

async function findPortalProfileForUserContext({
  tenantId,
  userId,
  userEmail,
  select = null,
  linkIfFound = false,
  actorId = null,
  source = "portal.profileLookup",
}) {
  const portalUser = await User.findOne({
    tenantId,
    userId,
    userType: "PORTAL",
    isActive: true,
  }).lean();

  const userIdCandidates = [];
  if (portalUser?._id) userIdCandidates.push(portalUser._id);
  const legacyUserObjectId = objectIdCandidate(userId);
  if (legacyUserObjectId) userIdCandidates.push(legacyUserObjectId);

  let query = Profile.findOne({
    tenantId,
    isActive: true,
    ...(userIdCandidates.length
      ? { userId: { $in: userIdCandidates } }
      : { _id: null }),
  });
  if (select) query = query.select(select);
  let profile = await query.lean();
  if (profile || !linkIfFound) return { profile, portalUser };

  const normalizedEmail = (
    portalUser?.userEmail ||
    userEmail ||
    ""
  ).trim().toLowerCase();
  const memberNumber = portalUser?.userMemberNumber || null;

  if (!normalizedEmail && !memberNumber) return { profile: null, portalUser };

  query = Profile.findOne({
    tenantId,
    isActive: true,
    $or: [
      ...(normalizedEmail ? [{ normalizedEmail }] : []),
      ...(memberNumber ? [{ membershipNumber: memberNumber }] : []),
    ],
  });
  if (select) query = query.select(select);
  const profileByIdentity = await query.lean();
  if (!profileByIdentity) return { profile: null, portalUser };

  if (portalUser?._id) {
    const beforeLean = await Profile.findById(profileByIdentity._id).lean();
    await Profile.updateOne(
      { _id: profileByIdentity._id, tenantId },
      { $set: { userId: portalUser._id } },
    );
    await publishProfileAfterUpdateOne({
      tenantId,
      profileId: profileByIdentity._id,
      beforeLean,
      actorId,
      source,
    });
    profile = {
      ...profileByIdentity,
      userId: portalUser._id,
    };
  } else {
    profile = profileByIdentity;
  }

  return { profile, portalUser };
}

function requestHasUsableFilters(bodyFilters) {
  if (
    !bodyFilters ||
    typeof bodyFilters !== "object" ||
    Array.isArray(bodyFilters)
  ) {
    return false;
  }
  return Object.values(bodyFilters).some(
    (fe) => fe && Array.isArray(fe.values) && fe.values.length > 0,
  );
}

/**
 * Apply derived fields (age, fullAddress, fullName, date conversions) to the payload.
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

  if (data.personalInfo) {
    stampPersonalInfoFullName(data.personalInfo);
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

    if (data.contactInfo.eircode?.trim()) {
      parts.push(data.contactInfo.eircode.trim());
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
  "isActive",
  "deactivatedAt",
]);

const FULL_MEMBERSHIP_UPDATE_ROLES = new Set([
  "SU",
  "SUPER USER",
  "ASU",
  "ASSISTANT SUPER USER",
  "MO",
  "MEMBERSHIP OFFICER",
  "AMO",
  "ASSISTANT MEMBERSHIP OFFICER",
]);

const LIMITED_MEMBERSHIP_UPDATE_FIELDS = new Set([
  "personalInfo",
  "contactInfo",
  "preferences",
  "normalizedEmail",
]);

function normalizeRoleValue(role) {
  if (!role) return "";
  const raw =
    typeof role === "string"
      ? role
      : role.code || role.name || role.roleCode || role.roleName || "";
  return String(raw).trim().toUpperCase();
}

function collectRequestRoles(req) {
  const roles = [
    ...(Array.isArray(req.roles) ? req.roles : []),
    ...(Array.isArray(req.user?.roles) ? req.user.roles : []),
    ...(Array.isArray(req.ctx?.roles) ? req.ctx.roles : []),
  ];
  return [...new Set(roles.map(normalizeRoleValue).filter(Boolean))];
}

function collectRequestPermissions(req) {
  const permissions = [
    ...(Array.isArray(req.permissions) ? req.permissions : []),
    ...(Array.isArray(req.user?.permissions) ? req.user.permissions : []),
    ...(Array.isArray(req.ctx?.permissions) ? req.ctx.permissions : []),
  ];
  return [...new Set(permissions.filter(Boolean))];
}

function hasFullMembershipUpdateRole(req) {
  return collectRequestRoles(req).some((role) =>
    FULL_MEMBERSHIP_UPDATE_ROLES.has(role),
  );
}

function hasMembershipProfileWritePermission(req) {
  const permissions = collectRequestPermissions(req);
  return permissions.some((permission) =>
    [
      "*",
      "admin",
      "crm:member:write",
      "crm:member:update",
      "profile:write",
      "profile:update",
      "portal:write",
    ].includes(permission),
  );
}

function enforceMembershipProfileUpdateScope(req, updates) {
  if (hasFullMembershipUpdateRole(req)) return null;

  if (!hasMembershipProfileWritePermission(req)) {
    return AppError.forbidden(
      "Membership profile write permission required",
    );
  }

  const disallowedFields = Object.keys(updates).filter(
    (key) => !LIMITED_MEMBERSHIP_UPDATE_FIELDS.has(key),
  );
  if (disallowedFields.length > 0) {
    return AppError.forbidden(
      "Only Membership Officer and Assistant Membership Officer roles can update full membership details",
      { disallowedFields },
    );
  }

  return null;
}

function escapeRegex(value = "") {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function enrichProfilesListWithSubscriptions(profiles, tenantId, req) {
  const profilesToEnrich = profiles.filter((p) => p.currentSubscriptionId);
  const subMap = new Map();
  if (profilesToEnrich.length > 0) {
    const subs = await Promise.all(
      profilesToEnrich.map((p) =>
        fetchCurrentSubscriptionByProfileId(
          p._id?.toString(),
          p.tenantId ?? tenantId,
          req,
          p.currentSubscriptionId?.toString?.() ?? p.currentSubscriptionId,
        ).then((sub) => ({ profileId: p._id.toString(), sub })),
      ),
    );
    subs.forEach(({ profileId, sub }) => {
      if (sub) subMap.set(profileId, sub);
    });
  }

  return profiles.map((p) => {
    const sub = subMap.get(p._id?.toString()) ?? null;
    const row = {
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
    enrichPersonalInfoFullNameOnDocument(row);
    return row;
  });
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
    const limit = parseInt(req.query.limit) || 500;
    const skip = (page - 1) * limit;

    const query = { tenantId, isActive: { $ne: false } };

    const [profiles, total] = await Promise.all([
      Profile.find(query)
        .populate("crmUserId", "userFullName")
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Profile.countDocuments(query),
    ]);

    const enriched = await enrichProfilesListWithSubscriptions(
      profiles,
      tenantId,
      req,
    );

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
      AppError.internalServerError(error.message || "Failed to fetch profiles"),
    );
  }
}

async function getProfilesWithTemplate(req, res, next) {
  try {
    const { userType, creatorId, tenantId: ctxTenantId } =
      extractUserAndCreatorContext(req);
    if (userType !== "CRM") {
      return next(
        AppError.forbidden(
          "Access denied. Only CRM users can filter profiles with templates.",
        ),
      );
    }

    const tenantId = req.tenantId;
    if (!tenantId) {
      return next(AppError.badRequest("Tenant context required"));
    }

    const page = req.body.page ? parseInt(req.body.page, 10) : 1;
    const limit = req.body.limit ? parseInt(req.body.limit, 10) : 500;
    const templateId = req.body.templateId;

    let template;

    if (templateId) {
      template = await applicationFilterTemplateService.getTemplateById(
        templateId,
        creatorId,
        ctxTenantId || null,
      );

      const resolvedType = template.templateType || "application";
      if (resolvedType !== "profile") {
        return next(
          AppError.badRequest(
            "This template is not a profile template. Use a template with templateType 'profile'.",
          ),
        );
      }
    } else {
      template =
        await applicationFilterTemplateService.getDefaultTemplateForType(
          creatorId,
          "profile",
          ctxTenantId || null,
        );
      if (!template) {
        try {
          template =
            await applicationFilterTemplateService.getSystemDefaultTemplate(
              "profile",
              ctxTenantId || null,
            );
        } catch {
          template = {
            filters: {},
            _id: null,
            isDefault: false,
            systemDefault: false,
          };
        }
      }
    }

    const bodyFilters =
      req.body &&
      req.body.filters &&
      typeof req.body.filters === "object" &&
      !Array.isArray(req.body.filters)
        ? req.body.filters
        : null;
    const filters = requestHasUsableFilters(bodyFilters)
      ? bodyFilters
      : (template.filters || {});

    const membershipCategoryFilter = filters.membershipCategory;
    const baseFilters = { ...filters };
    delete baseFilters.membershipCategory;

    const result = await profileFilterHandler.getProfilesWithTemplateFilters(
      tenantId,
      baseFilters,
      page,
      limit,
    );

    let enriched = await enrichProfilesListWithSubscriptions(
      result.profiles,
      tenantId,
      req,
    );

    // Apply membershipCategory filtering strictly from subscription-service-enriched field.
    if (
      membershipCategoryFilter &&
      Array.isArray(membershipCategoryFilter.values) &&
      membershipCategoryFilter.values.length > 0
    ) {
      const selected = membershipCategoryFilter.values
        .map((v) => String(v || "").trim().toLowerCase())
        .filter(Boolean);
      if (selected.length > 0) {
        const isEqual =
          membershipCategoryFilter.operator === "equal_to" ||
          membershipCategoryFilter.operator === "==";
        enriched = enriched.filter((row) => {
          const category = String(row?.membershipCategory || "")
            .trim()
            .toLowerCase();
          const matched = selected.includes(category);
          return isEqual ? matched : !matched;
        });
      }
    }

    return res.success({
      count: enriched.length,
      total: enriched.length,
      page: result.page,
      limit: result.limit,
      totalPages: Math.ceil(enriched.length / result.limit),
      results: enriched,
    });
  } catch (error) {
    console.error(
      "ProfileController [getProfilesWithTemplate] Error:",
      error,
    );
    if (error.isJoi) {
      return next(AppError.badRequest("Validation error: " + error.message));
    }
    if (error.message && error.message.includes("not found")) {
      return next(AppError.notFound(error.message));
    }
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch profiles with template",
      ),
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
        "i",
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

    const limit = Math.min(
      1000,
      Math.max(1, parseInt(req.query.limit, 10) || 500),
    );

    const results = await Profile.find(query)
      .populate("crmUserId", "userFullName")
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();

    enrichPersonalInfoFullNameOnDocuments(results);

    return res.success({
      count: results.length,
      results,
    });
  } catch (error) {
    return next(
      AppError.internalServerError(
        error.message || "Failed to search profiles",
      ),
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
        next,
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
        subId,
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
    enrichPersonalInfoFullNameOnDocument(enriched);
    return res.success(enriched);
  } catch (error) {
    return next(
      AppError.internalServerError(error.message || "Failed to fetch profile"),
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

    const scopeError = enforceMembershipProfileUpdateScope(req, updates);
    if (scopeError) {
      return next(scopeError);
    }

    const profile = await Profile.findOne({
      _id: profileId,
      tenantId,
    }).populate("crmUserId", "userFullName");

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

    if (updates.personalInfo) {
      const existingPersonalInfo = profile.personalInfo?.toObject
        ? profile.personalInfo.toObject()
        : profile.personalInfo || {};
      updates.personalInfo = {
        ...existingPersonalInfo,
        ...updates.personalInfo,
      };
    }

    const existingProfessionalDetails = profile.professionalDetails?.toObject
      ? profile.professionalDetails.toObject()
      : profile.professionalDetails || {};
    const effectiveProfessionalDetails = updates.professionalDetails
      ? { ...existingProfessionalDetails, ...updates.professionalDetails }
      : existingProfessionalDetails;

    if (updates.professionalDetails) {
      updates.professionalDetails = effectiveProfessionalDetails;
    }

    applyDerivedFields(updates);

    const currentSubscription = await fetchCurrentSubscriptionByProfileId(
      profileId,
      tenantId,
      req,
      profile.currentSubscriptionId?.toString?.() ??
        profile.currentSubscriptionId,
    );
    const {
      isNoFeeMembershipCategory,
    } = require("../helpers/noFeeMembershipPayment.helper.js");
    const subscriptionCategory = currentSubscription?.membershipCategory;
    const skipSalaryDeductionValidation =
      isNoFeeMembershipCategory(subscriptionCategory);
    if (currentSubscription?.paymentType && !skipSalaryDeductionValidation) {
      const {
        assertSalaryDeductionAllowedForWorkLocation,
      } = require("../helpers/workLocationPayment.helper.js");
      await assertSalaryDeductionAllowedForWorkLocation(
        { paymentType: currentSubscription.paymentType },
        effectiveProfessionalDetails,
        { req, tenantId },
      );
    }

    const { creatorId } = extractUserAndCreatorContext(req);
    profile.$locals.__auditActorId = creatorId;
    profile.set(updates);

    await profile.save();

    const populatedProfile = await Profile.findById(profile._id)
      .populate("crmUserId", "userFullName")
      .lean();

    enrichPersonalInfoFullNameOnDocument(populatedProfile);
    return res.success(populatedProfile);
  } catch (error) {
    if (error.name === "AppError") {
      return next(error);
    }
    if (error.name === "ValidationError") {
      return next(AppError.badRequest(error.message));
    }
    if (error.code === 11000) {
      return next(
        AppError.conflict("Duplicate value for unique field", {
          duplicateKey: error.keyValue,
        }),
      );
    }
    return next(
      AppError.internalServerError(error.message || "Failed to update profile"),
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
    }).populate("crmUserId", "userFullName");

    if (!profile) {
      return next(AppError.notFound("Profile not found"));
    }

    profile.isActive = false;
    profile.deactivatedAt = new Date();

    const { creatorId } = extractUserAndCreatorContext(req);
    profile.$locals.__auditActorId = creatorId;
    profile.$locals.__auditEventType = "profile.deleted";

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
      AppError.internalServerError(error.message || "Failed to delete profile"),
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
        AppError.forbidden("This endpoint is only available for Portal users"),
      );
    }

    if (!userId) {
      return next(AppError.badRequest("User ID is required"));
    }

    const { profile, portalUser } = await findPortalProfileForUserContext({
      tenantId,
      userId,
      userEmail: req.user?.email,
      select: "_id membershipNumber userId normalizedEmail",
      linkIfFound: true,
      actorId: userId,
      source: "portal.getMyProfile.userIdLink",
    });

    if (!profile) {
      console.log("No profile found by portal user context:", {
        userId,
        tenantId,
        portalUserId: portalUser?._id,
        userEmail: portalUser?.userEmail || req.user?.email,
      });

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
        error.message || "Failed to fetch profile information",
      ),
    );
  }
}

async function updateMyProfile(req, res, next) {
  try {
    const { userId, userType, tenantId } = extractUserAndCreatorContext(req);

    if (userType !== "PORTAL") {
      return next(AppError.forbidden("Access denied. Only for PORTAL users."));
    }

    if (!userId) {
      return next(
        AppError.badRequest(
          "User ID is required. Please ensure you are properly authenticated.",
        ),
      );
    }

    const validatedData = await joischemas.profile_update.validateAsync(
      req.body,
    );

    const { profile: profileLean } = await findPortalProfileForUserContext({
      tenantId,
      userId,
      userEmail: req.user?.email,
      select: "_id",
      linkIfFound: true,
      actorId: userId,
      source: "portal.updateMyProfile.userIdLink",
    });

    const profile = profileLean
      ? await Profile.findOne({ _id: profileLean._id, tenantId })
      : null;

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

    const { creatorId } = extractUserAndCreatorContext(req);
    profile.$locals.__auditActorId = creatorId;

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

    bizLogger.business("Portal profile updated", {
      eventType: "ProfileUpdated",
      profileId: String(profile._id),
      membershipId: profile.membershipNumber
        ? String(profile.membershipNumber)
        : null,
    }, req);

    const populatedProfile = await Profile.findById(profile._id)
      .populate("crmUserId", "userFullName")
      .lean();

    enrichPersonalInfoFullNameOnDocument(populatedProfile);
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
        }),
      );
    if (error.message === "Profile not found")
      return next(AppError.notFound("Profile not found"));
    return next(
      AppError.internalServerError(error.message || "Failed to update profile"),
    );
  }
}

async function getCornMarketNew(req, res, next) {
  try {
    const { userType } = extractUserAndCreatorContext(req);

    // Only allow CRM users
    if (userType !== "CRM") {
      return next(
        AppError.forbidden("This endpoint is only available for CRM users"),
      );
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 500;
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
          .filter((id) => id !== null && id !== undefined),
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

    enrichPersonalInfoFullNameOnDocuments(profiles);

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
        error.message || "Failed to fetch corn market new profiles",
      ),
    );
  }
}

async function getCornMarketGraduate(req, res, next) {
  try {
    const { userType } = extractUserAndCreatorContext(req);

    // Only allow CRM users
    if (userType !== "CRM") {
      return next(
        AppError.forbidden("This endpoint is only available for CRM users"),
      );
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 500;
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
          .filter((id) => id !== null && id !== undefined),
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

    enrichPersonalInfoFullNameOnDocuments(profiles);

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
        error.message || "Failed to fetch corn market graduate profiles",
      ),
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
      return next(
        AppError.badRequest(
          "Invalid email format. Email must contain @ symbol",
        ),
      );
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
      const personalInfoSlice = {
        title: existingProfile.personalInfo?.title,
        forename: existingProfile.personalInfo?.forename,
        surname: existingProfile.personalInfo?.surname,
        dateOfBirth: existingProfile.personalInfo?.dateOfBirth,
        age: existingProfile.personalInfo?.age,
        gender: existingProfile.personalInfo?.gender,
      };
      stampPersonalInfoFullName(personalInfoSlice);
      // Return basic profile details
      return res.success({
        exists: true,
        message: "Profile with this email already exists",
        profile: {
          profileId: existingProfile._id,
          membershipNumber: existingProfile.membershipNumber,
          isActive: existingProfile.isActive,
          personalInfo: personalInfoSlice,
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
        error.message || "Failed to check email existence",
      ),
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
        AppError.forbidden("This endpoint is only available for Portal users"),
      );
    }

    if (!userId) {
      return next(AppError.badRequest("User ID is required"));
    }

    const personalDetails = await personalDetailsService.getMyPersonalDetails(
      userId,
      tenantId,
    );

    if (!personalDetails) {
      return res.status(200).json({
        data: null,
        message: "Personal details not found",
      });
    }

    enrichPersonalInfoFullNameOnDocument(personalDetails);
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
        error.message || "Failed to fetch personal details",
      ),
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
        AppError.forbidden("This endpoint is only available for Portal users"),
      );
    }

    if (!userId) {
      return next(AppError.badRequest("User ID is required"));
    }

    const professionalDetails =
      await professionalDetailsService.getMyProfessionalDetails(
        userId,
        tenantId,
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
        error.message || "Failed to fetch professional details",
      ),
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
        AppError.forbidden("This endpoint is only available for Portal users"),
      );
    }

    if (!userId) {
      return next(AppError.badRequest("User ID is required"));
    }

    let subscriptionDetails =
      await subscriptionDetailsService.getMySubscriptionDetails(
        userId,
        tenantId,
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
        error.message || "Failed to fetch subscription details",
      ),
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
        AppError.forbidden("This endpoint is only available for Portal users"),
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
        personalDetails.status === "fulfilled" ? personalDetails.value : null,
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

    enrichPersonalInfoFullNameOnDocument(result.personalDetails);
    return res.success(result);
  } catch (error) {
    console.error("ProfileController [getMyAllDetails] Error:", error);
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch user details",
      ),
    );
  }
}

const BATCH_PROFILE_LOOKUP_SELECT =
  "membershipNumber personalInfo contactInfo professionalDetails preferences tenantId";

function parseProfileIdsFromRequest(req) {
  let profileIds = req.body?.profileIds;
  if (!profileIds || !Array.isArray(profileIds)) {
    const q = req.query?.profileIds;
    profileIds =
      typeof q === "string"
        ? q
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : Array.isArray(q)
          ? q.filter((id) => id != null && String(id).trim())
          : [];
  }
  return profileIds;
}

function profileIdsToObjectIds(profileIds) {
  return profileIds
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
}

async function findProfilesByObjectIds(objectIds, tenantId) {
  if (!objectIds.length) return [];
  const query = { _id: { $in: objectIds } };
  if (tenantId) {
    query.tenantId = tenantId;
  }
  const profiles = await Profile.find(query)
    .select(BATCH_PROFILE_LOOKUP_SELECT)
    .lean();
  enrichPersonalInfoFullNameOnDocuments(profiles);
  return profiles;
}

/**
 * CRM-authenticated batch lookup by profile IDs (gateway JWT / headers).
 * POST /api/profile/batch-lookup
 */
async function getProfilesBatchAuthenticated(req, res, next) {
  try {
    const profileIds = parseProfileIdsFromRequest(req);
    if (!profileIds.length) {
      return res.status(400).json({
        success: false,
        message:
          "profileIds array is required and must not be empty (body.profileIds or query.profileIds)",
      });
    }
  if (profileIds.length > 5000) {
    return next(
      AppError.badRequest("Too many profileIds (max 5000 per request)"),
    );
  }

    const objectIds = profileIdsToObjectIds(profileIds);
    const profiles = await findProfilesByObjectIds(objectIds, req.tenantId);

    return res.status(200).json({
      success: true,
      data: profiles,
    });
  } catch (error) {
    console.error(
      "ProfileController [getProfilesBatchAuthenticated] Error:",
      error,
    );
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch profiles by IDs",
      ),
    );
  }
}

/**
 * CRM-authenticated lookup by membership numbers (batch Excel matching, finance identity).
 * POST /api/profile/lookup-by-membership
 * Body: { membershipNumbers: string[], diagnose?: boolean }
 */
async function lookupProfilesByMembershipNumbers(req, res, next) {
  try {
    let membershipNumbers = req.body?.membershipNumbers;
    if (!Array.isArray(membershipNumbers)) {
      return next(AppError.badRequest("membershipNumbers array is required"));
    }

    membershipNumbers = [
      ...new Set(
        membershipNumbers.map((n) => String(n).trim()).filter(Boolean),
      ),
    ];
    if (membershipNumbers.length > 5000) {
      return next(
        AppError.badRequest("Too many membershipNumbers (max 5000 per request)"),
      );
    }
    if (membershipNumbers.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const tenantId = req.tenantId;
    const tenantFilter = tenantId ? { tenantId } : {};

    let profiles = await Profile.find({
      ...tenantFilter,
      membershipNumber: { $in: membershipNumbers },
    })
      .select(BATCH_PROFILE_LOOKUP_SELECT)
      .lean();

    const foundKeys = new Set(
      profiles.map((p) => String(p.membershipNumber || "").trim().toLowerCase()),
    );
    const missingExact = membershipNumbers.filter(
      (n) => !foundKeys.has(n.toLowerCase()),
    );

    if (missingExact.length && tenantId) {
      for (const mn of missingExact) {
        const ci = await Profile.findOne({
          tenantId,
          membershipNumber: {
            $regex: new RegExp(`^${escapeRegex(mn)}$`, "i"),
          },
        })
          .select(BATCH_PROFILE_LOOKUP_SELECT)
          .lean();
        if (ci) {
          profiles.push(ci);
          foundKeys.add(String(ci.membershipNumber || "").trim().toLowerCase());
        }
      }
    }

    enrichPersonalInfoFullNameOnDocuments(profiles);

    const diagnose =
      req.body?.diagnose === true && membershipNumbers.length === 1;
    if (diagnose && profiles.length === 0 && tenantId) {
      const mn = membershipNumbers[0];
      const byNumber = await Profile.findOne({ membershipNumber: mn })
        .select("tenantId membershipNumber")
        .lean();
      const byNumberCi =
        byNumber ||
        (await Profile.findOne({
          membershipNumber: {
            $regex: new RegExp(`^${escapeRegex(mn)}$`, "i"),
          },
        })
          .select("tenantId membershipNumber")
          .lean());

      if (byNumberCi) {
        const pt = byNumberCi.tenantId;
        if (pt != null && pt !== "" && pt !== tenantId) {
          return res.status(200).json({
            success: true,
            data: [],
            lookupError:
              "A profile exists for this membership number but under a different tenant than your session. Align profile.tenantId with the gateway x-tenant-id (or use the correct CRM tenant).",
          });
        }
        if (pt == null || pt === "") {
          return res.status(200).json({
            success: true,
            data: [],
            lookupError:
              "A profile exists for this membership number but it has no tenantId set; batch resolution requires tenantId on the profile to match your session.",
          });
        }
        if (pt === tenantId) {
          const full = await Profile.findById(byNumberCi._id)
            .select(BATCH_PROFILE_LOOKUP_SELECT)
            .lean();
          if (full) {
            enrichPersonalInfoFullNameOnDocument(full);
            return res.status(200).json({ success: true, data: [full] });
          }
        }
      }

      return res.status(200).json({
        success: true,
        data: [],
        lookupError:
          "No profile found with this membership number. Confirm the member exists in profile-service and the number matches exactly.",
      });
    }

    return res.status(200).json({ success: true, data: profiles });
  } catch (error) {
    console.error(
      "ProfileController [lookupProfilesByMembershipNumbers] Error:",
      error,
    );
    return next(
      AppError.internalServerError(
        error.message || "Failed to lookup profiles by membership number",
      ),
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
        req.tenantId =
          decoded.tenantId || decoded.tid || decoded.extension_tenantId;
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
      profileIds =
        typeof q === "string"
          ? q
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : Array.isArray(q)
            ? q.filter((id) => id != null && String(id).trim())
            : [];
    }

    if (!profileIds || profileIds.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "profileIds array is required and must not be empty (body.profileIds or query.profileIds)",
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
    const relaxTenant =
      isInternalRequest &&
      (req.query?.relaxTenant === "true" || req.query?.relaxTenant === "1");
    if (req.tenantId && !relaxTenant) {
      query.tenantId = req.tenantId;
    }
    const profiles = await Profile.find(query).lean();

    enrichPersonalInfoFullNameOnDocuments(profiles);

    return res.status(200).json({
      success: true,
      data: profiles,
    });
  } catch (error) {
    console.error("ProfileController [getProfilesBatch] Error:", error);
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch profiles by IDs",
      ),
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
    console.error(
      "ProfileController [getProfileByEmailInternal] Error:",
      error,
    );
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch profile by email",
      ),
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
        req.tenantId =
          decoded.tenantId || decoded.tid || decoded.extension_tenantId;
        hasValidJWT = true;
      } catch (error) {
        // JWT validation failed, but we'll still allow if internal header is present
        console.warn(
          "JWT validation failed for internal endpoint:",
          error.message,
        );
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

    const normalizedUserIds = [
      ...new Set(userIds.map((id) => String(id || "").trim()).filter(Boolean)),
    ];

    const syncedUsers = await User.find({
      userId: { $in: normalizedUserIds },
      ...(req.tenantId ? { tenantId: req.tenantId } : {}),
      userType: "PORTAL",
      isActive: true,
    })
      .select("_id userId userEmail tenantId")
      .lean();

    const syncedUserBySourceId = new Map(
      syncedUsers.map((user) => [String(user.userId), user]),
    );

    // Convert userIds to ObjectIds for legacy rows and include local synced User._id
    // values because Profile.userId references profile-service users._id.
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

    for (const user of syncedUsers) {
      objectIdUserIds.push(user._id);
    }

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
        "userId tenantId personalInfo contactInfo membershipNumber currentSubscriptionId isActive normalizedEmail",
      )
      .lean();

    const foundUserIds = new Set(profiles.map((profile) => String(profile.userId)));
    const emailFallbackUsers = syncedUsers.filter((user) => {
      if (!user.userEmail) return false;
      return !foundUserIds.has(String(user._id));
    });

    if (emailFallbackUsers.length > 0) {
      const fallbackProfiles = await Profile.find({
        $or: emailFallbackUsers.map((user) => ({
          tenantId: user.tenantId,
          normalizedEmail: normalizeEmail(user.userEmail),
          isActive: { $ne: false },
        })),
      })
        .select(
          "userId tenantId personalInfo contactInfo membershipNumber currentSubscriptionId isActive normalizedEmail",
        )
        .lean();

      profiles.push(...fallbackProfiles);
    }

    enrichPersonalInfoFullNameOnDocuments(profiles);

    // Create a map of userId -> profile for easy lookup
    // Map each profile to all possible userId formats (ObjectId string and original string)
    const profilesByUserId = {};

    profiles.forEach((profile) => {
      if (profile.userId) {
        const profileUserIdStr = String(profile.userId);

        // Find the original userId from the request that matches this profile's userId
        // This handles the case where FCMToken.userId is a string but Profile.userId is ObjectId
        const matchingOriginalId = normalizedUserIds.find((id) => {
          const originalIdStr = String(id);
          const syncedUser = syncedUserBySourceId.get(originalIdStr);
          // Compare both as strings - MongoDB ObjectId comparison works with string comparison
          return (
            originalIdStr === profileUserIdStr ||
            (syncedUser && String(syncedUser._id) === profileUserIdStr) ||
            (syncedUser &&
              syncedUser.userEmail &&
              syncedUser.tenantId === profile.tenantId &&
              normalizeEmail(syncedUser.userEmail) === profile.normalizedEmail)
          );
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
        error.message || "Failed to fetch profiles by user IDs",
      ),
    );
  }
}

// Internal endpoint: find-or-create a Profile with no membership number, for
// event/course attendee registration (portal, mobile, CRM). Never creates
// PersonalDetails/ProfessionalDetails/SubscriptionDetails and never touches the
// membership application/approval pipeline.
async function findOrCreateAttendeeProfile(req, res, next) {
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

    const {
      tenantId,
      email,
      firstName,
      lastName,
      phone,
      workLocation,
      grade,
      addressLine1,
      addressLine2,
      townCity,
      countyState,
      eircode,
      country,
    } = req.body || {};
    if (!tenantId || !email) {
      return res.status(400).json({
        success: false,
        message: "tenantId and email are required",
      });
    }

    const {
      findOrCreateAttendeeProfile: findOrCreateAttendeeProfileHelper,
    } = require("../helpers/attendeeProfileLookup.helper.js");

    const { profile, created } = await findOrCreateAttendeeProfileHelper({
      tenantId,
      email,
      firstName,
      lastName,
      phone,
      workLocation,
      grade,
      addressLine1,
      addressLine2,
      townCity,
      countyState,
      eircode,
      country,
    });

    return res.status(200).json({
      success: true,
      data: {
        profileId: profile._id.toString(),
        membershipNumber: profile.membershipNumber || null,
        created,
        isMember: !!profile.membershipNumber,
      },
    });
  } catch (error) {
    console.error(
      "ProfileController [findOrCreateAttendeeProfile] Error:",
      error,
    );
    return next(
      AppError.internalServerError(
        error.message || "Failed to find or create attendee profile",
      ),
    );
  }
}

// Internal endpoint: read-only duplicate check for a would-be new
// event/course attendee (portal, mobile, CRM) - never creates a Profile. See
// helpers/attendeeProfileLookup.helper.js's checkAttendeeDuplicates for the
// exact-email vs fuzzy-review vs no-match resolution semantics.
async function checkAttendeeDuplicates(req, res, next) {
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

    const {
      tenantId,
      email,
      firstName,
      lastName,
      phone,
      addressLine1,
      townCity,
      countyState,
      eircode,
      country,
    } = req.body || {};
    if (!tenantId || !email) {
      return res.status(400).json({
        success: false,
        message: "tenantId and email are required",
      });
    }

    const {
      checkAttendeeDuplicates: checkAttendeeDuplicatesHelper,
    } = require("../helpers/attendeeProfileLookup.helper.js");

    const result = await checkAttendeeDuplicatesHelper({
      tenantId,
      email,
      firstName,
      lastName,
      phone,
      addressLine1,
      townCity,
      countyState,
      eircode,
      country,
    });

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("ProfileController [checkAttendeeDuplicates] Error:", error);
    return next(
      AppError.internalServerError(
        error.message || "Failed to check attendee duplicates",
      ),
    );
  }
}

module.exports = {
  getAllProfiles,
  getProfilesWithTemplate,
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
  getProfilesBatchAuthenticated,
  lookupProfilesByMembershipNumbers,
  getProfilesByUserIds,
  getProfileByEmailInternal,
  findOrCreateAttendeeProfile,
  checkAttendeeDuplicates,
};

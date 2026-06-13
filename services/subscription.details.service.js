const subscriptionDetailsHandler = require("../handlers/subscription.details.handler");
const personalDetailsHandler = require("../handlers/personal.details.handler");
const professionalDetailsHandler = require("../handlers/professional.details.handler");
const { APPLICATION_STATUS } = require("../constants/enums");
const { AppError } = require("../errors/AppError");
const mongoose = require("mongoose");
const bizLogger = require("../config/bizLogger.js");
const {
  normalizeSubscriptionDetailsDates,
} = require("../helpers/parseDateOnly.js");
const {
  subscriptionDetailsToPlain,
} = require("../helpers/membershipCategory.helper.js");

const isObjectIdValue = (value) => {
  if (!value) return false;
  if (value instanceof mongoose.Types.ObjectId) return true;
  if (typeof value === "string") {
    return mongoose.Types.ObjectId.isValid(value) && value.length === 24;
  }
  return false;
};

async function resolveMembershipCategoryName(membershipCategoryId) {
  if (membershipCategoryId == null || membershipCategoryId === "") return "";
  if (!isObjectIdValue(membershipCategoryId)) {
    return String(membershipCategoryId);
  }

  const categoryIdString = membershipCategoryId.toString();
  try {
    let Lookup;
    try {
      Lookup = mongoose.model("Lookup");
    } catch (modelError) {
      const lookupSchema = new mongoose.Schema(
        {
          code: { type: String, required: true },
          lookupname: { type: String, required: true },
          DisplayName: { type: String },
          Parentlookupid: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Lookup",
            default: null,
          },
          lookuptypeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "LookupType",
            required: true,
          },
          isdeleted: { type: Boolean, default: false },
          isactive: { type: Boolean, default: true },
          userid: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
          },
        },
        { timestamps: true },
      );
      Lookup = mongoose.model("Lookup", lookupSchema);
    }

    const lookup = await Lookup.findById(categoryIdString);
    if (lookup?.lookupname) {
      return lookup.lookupname;
    }
  } catch (lookupError) {
    console.error(
      `❌ [PROFILE_SUBSCRIPTION_SERVICE] Error fetching lookup for ID ${categoryIdString}:`,
      lookupError.message,
    );
  }

  return categoryIdString;
}

async function applySubmittedStatusAfterSubscriptionSave({
  applicationId,
  userId,
  userType,
  tenantId,
  personalDetails,
  membershipCategoryRaw,
}) {
  if (!personalDetails || !applicationId) return;

  const currentStatus = String(
    personalDetails.applicationStatus || APPLICATION_STATUS.IN_PROGRESS,
  ).toLowerCase();

  if (
    currentStatus !== APPLICATION_STATUS.IN_PROGRESS &&
    currentStatus !== ""
  ) {
    return;
  }

  const membershipCategoryName = await resolveMembershipCategoryName(
    membershipCategoryRaw,
  );
  const isUndergraduateStudent =
    membershipCategoryName &&
    membershipCategoryName.toLowerCase() === "undergraduate student";

  if (userType === "CRM") {
    console.log(
      "📝 [PROFILE_SUBSCRIPTION_SERVICE] CRM user - updating status to submitted (bypassing payment flow)",
    );
    await personalDetailsHandler.updateApplicationStatus(
      applicationId,
      APPLICATION_STATUS.SUBMITTED,
      tenantId,
    );
    bizLogger.business("Application submitted after subscription details (CRM)", {
      eventType: "ApplicationSubmitted",
      applicationId,
      tenantId: tenantId != null ? String(tenantId) : null,
      profileId: personalDetails.profileId
        ? String(personalDetails.profileId)
        : null,
      userId: userId != null ? String(userId) : null,
    });
    return;
  }

  if (userType === "PORTAL" && isUndergraduateStudent) {
    console.log(
      "📝 [PROFILE_SUBSCRIPTION_SERVICE] PORTAL user + Undergraduate Student - updating status to submitted (no payment required)",
    );
    await personalDetailsHandler.updateApplicationStatus(
      applicationId,
      APPLICATION_STATUS.SUBMITTED,
      tenantId,
    );
    bizLogger.business(
      "Application submitted after subscription details (portal undergraduate)",
      {
        eventType: "ApplicationSubmitted",
        applicationId,
        tenantId: tenantId != null ? String(tenantId) : null,
        profileId: personalDetails.profileId
          ? String(personalDetails.profileId)
          : null,
        userId: userId != null ? String(userId) : null,
      },
    );
    return;
  }

  if (userType === "PORTAL" && !isUndergraduateStudent) {
    console.log(
      "ℹ️ [PROFILE_SUBSCRIPTION_SERVICE] PORTAL user + Non-Undergraduate Student - keeping status as in-progress until payment is received",
    );
    return;
  }

  console.warn(
    `⚠️ [PROFILE_SUBSCRIPTION_SERVICE] Unexpected userType: ${userType}, keeping status unchanged`,
  );
}

/**
 * Subscription Details Service Layer
 * Contains business logic for subscription details operations
 */
class SubscriptionDetailsService {
  /**
   * Create subscription details
   * @param {Object} data - Subscription details data
   * @param {string} applicationId - Application ID
   * @param {string} userId - User ID
   * @param {string} userType - User type (CRM/PORTAL)
   * @returns {Promise<Object>} Created subscription details
   */
  async createSubscriptionDetails(
    data,
    applicationId,
    userId,
    userType,
    tenantId,
    req = null
  ) {
    try {
      if (!data) {
        throw AppError.badRequest("Subscription details data is required");
      }

      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      // Check if application exists
      const personalDetails = await personalDetailsHandler.getApplicationById(
        applicationId,
        tenantId
      );
      if (!personalDetails) {
        throw AppError.notFound("Application not found");
      }

      // Check if subscription details already exist
      const existingDetails =
        await subscriptionDetailsHandler.getByApplicationId(
          applicationId,
          tenantId
        );
      if (existingDetails) {
        return this.updateSubscriptionDetails(
          applicationId,
          {
            ...data,
            "meta.updatedBy": userId,
            "meta.userType": userType,
          },
          userId,
          userType,
          tenantId,
          req
        );
      }

      // Validate user permissions for PORTAL users
      if (userType !== "CRM") {
        if (personalDetails.userId?.toString() !== userId?.toString()) {
          throw AppError.forbidden(
            "Access denied. You can only create subscription details for your own applications."
          );
        }
      }

      const professionalDetails =
        await professionalDetailsHandler.getByApplicationId(
          applicationId,
          tenantId
        );
      const membershipCategoryFromProfessional =
        professionalDetails?.professionalDetails?.membershipCategory ?? null;

      const createData = {
        ...data,
        applicationId: applicationId,
        userId: userId,
        tenantId,
        meta: { createdBy: userId, userType },
      };

      if (!createData.subscriptionDetails) {
        createData.subscriptionDetails = {};
      }

      if (
        createData.subscriptionDetails.membershipCategory == null &&
        membershipCategoryFromProfessional != null
      ) {
        createData.subscriptionDetails.membershipCategory =
          membershipCategoryFromProfessional;
      }

      const {
        enforcePaymentFrequencyRule,
      } = require("../helpers/payment.frequency.helper.js");
      const {
        assertSalaryDeductionAllowedForWorkLocation,
      } = require("../helpers/workLocationPayment.helper.js");
      const {
        applyNoFeeMembershipPaymentDefaults,
      } = require("../helpers/noFeeMembershipPayment.helper.js");

      createData.subscriptionDetails = applyNoFeeMembershipPaymentDefaults(
        createData.subscriptionDetails,
      );
      createData.subscriptionDetails = enforcePaymentFrequencyRule(
        createData.subscriptionDetails
      );
      await assertSalaryDeductionAllowedForWorkLocation(
        createData.subscriptionDetails,
        professionalDetails?.professionalDetails,
        {
          req,
          tenantId,
          professionalDetailsOverride: req?.body?.professionalDetails,
        }
      );
      createData.subscriptionDetails = normalizeSubscriptionDetailsDates(
        createData.subscriptionDetails
      );

      const result = await subscriptionDetailsHandler.create(createData);

      await applySubmittedStatusAfterSubscriptionSave({
        applicationId,
        userId,
        userType,
        tenantId,
        personalDetails,
        membershipCategoryRaw:
          result?.subscriptionDetails?.membershipCategory ||
          membershipCategoryFromProfessional,
      });

      return result;
    } catch (error) {
      console.error(
        "SubscriptionDetailsService [createSubscriptionDetails] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Get subscription details by application ID
   * @param {string} applicationId - Application ID
   * @param {string} userId - User ID (for authorization)
   * @param {string} userType - User type (CRM/PORTAL)
   * @returns {Promise<Object>} Subscription details
   */
  async getSubscriptionDetails(applicationId, userId, userType, tenantId) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      // Validate parent resource: check if application exists
      const personalDetails = await personalDetailsHandler.getApplicationById(
        applicationId,
        tenantId
      );
      if (!personalDetails) {
        throw AppError.notFound("Application not found");
      }

      if (userType === "CRM") {
        return await subscriptionDetailsHandler.getApplicationById(
          applicationId,
          tenantId
        );
      } else {
        return await subscriptionDetailsHandler.getByUserIdAndApplicationId(
          userId,
          applicationId,
          tenantId
        );
      }
    } catch (error) {
      console.error(
        "SubscriptionDetailsService [getSubscriptionDetails] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Update subscription details
   * @param {string} applicationId - Application ID
   * @param {Object} updateData - Update data
   * @param {string} userId - User ID (for authorization)
   * @param {string} userType - User type (CRM/PORTAL)
   * @returns {Promise<Object>} Updated subscription details
   */
  async updateSubscriptionDetails(
    applicationId,
    updateData,
    userId,
    userType,
    tenantId,
    req = null
  ) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      if (!updateData) {
        throw AppError.badRequest("Update data is required");
      }

      // Preserve protected fields - don't allow API updates to overwrite them
      // - paymentDetails: only updated by payment webhook events (synced from portal-service)
      // - membershipNumber: only set during approval process
      const { paymentDetails, membershipNumber, ...safeUpdateData } =
        updateData;

      if (paymentDetails) {
        console.warn(
          "⚠️ [SUBSCRIPTION_SERVICE] Ignoring paymentDetails in update - payment info is synced from portal-service"
        );
      }

      if (membershipNumber) {
        console.warn(
          "⚠️ [SUBSCRIPTION_SERVICE] Ignoring membershipNumber in update - membership numbers are generated during approval"
        );
      }

      if (safeUpdateData.subscriptionDetails) {
        const {
          enforcePaymentFrequencyRule,
        } = require("../helpers/payment.frequency.helper.js");
        const {
          assertSalaryDeductionAllowedForWorkLocation,
        } = require("../helpers/workLocationPayment.helper.js");
        const {
          applyNoFeeMembershipPaymentDefaults,
        } = require("../helpers/noFeeMembershipPayment.helper.js");
        const [professionalDetails, existingDetails] = await Promise.all([
          professionalDetailsHandler.getByApplicationId(
            applicationId,
            tenantId,
          ),
          subscriptionDetailsHandler.getByApplicationId(
            applicationId,
            tenantId,
          ),
        ]);

        const mergedSubscriptionDetails = {
          ...subscriptionDetailsToPlain(existingDetails?.subscriptionDetails),
          ...safeUpdateData.subscriptionDetails,
        };

        safeUpdateData.subscriptionDetails = applyNoFeeMembershipPaymentDefaults(
          mergedSubscriptionDetails,
        );
        safeUpdateData.subscriptionDetails = enforcePaymentFrequencyRule(
          safeUpdateData.subscriptionDetails,
        );
        await assertSalaryDeductionAllowedForWorkLocation(
          safeUpdateData.subscriptionDetails,
          professionalDetails?.professionalDetails,
          {
            req,
            tenantId,
            professionalDetailsOverride: req?.body?.professionalDetails,
          }
        );
        safeUpdateData.subscriptionDetails = normalizeSubscriptionDetailsDates(
          safeUpdateData.subscriptionDetails
        );
      }

      const updatePayload = {
        ...safeUpdateData,
        "meta.updatedBy": userId,
        "meta.userType": userType,
      };

      let result;
      if (userType === "CRM") {
        const existingDetails =
          await subscriptionDetailsHandler.getByApplicationId(
            applicationId,
            tenantId
          );

        if (!existingDetails) {
          const personalDetails = await personalDetailsHandler.getApplicationById(
            applicationId,
            tenantId
          );
          if (!personalDetails) {
            throw AppError.notFound("Application not found");
          }

          result = await subscriptionDetailsHandler.create({
            applicationId,
            userId: personalDetails.userId ?? userId,
            tenantId: tenantId || personalDetails.tenantId,
            subscriptionDetails: safeUpdateData.subscriptionDetails || {},
            meta: {
              createdBy: userId,
              userType,
            },
          });
        } else {
          result = await subscriptionDetailsHandler.updateByApplicationId(
            applicationId,
            updatePayload,
            tenantId
          );
        }
      } else {
        result =
          await subscriptionDetailsHandler.updateByUserIdAndApplicationId(
            userId,
            applicationId,
            updatePayload,
            tenantId
          );
      }

      const personalDetails = await personalDetailsHandler.getApplicationById(
        applicationId,
        tenantId,
      );
      await applySubmittedStatusAfterSubscriptionSave({
        applicationId,
        userId,
        userType,
        tenantId,
        personalDetails,
        membershipCategoryRaw:
          result?.subscriptionDetails?.membershipCategory ||
          safeUpdateData?.subscriptionDetails?.membershipCategory,
      });

      return result;
    } catch (error) {
      console.error(
        "SubscriptionDetailsService [updateSubscriptionDetails] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Delete subscription details
   * @param {string} applicationId - Application ID
   * @param {string} userId - User ID (for authorization)
   * @param {string} userType - User type (CRM/PORTAL)
   * @returns {Promise<Object>} Deleted subscription details
   */
  async deleteSubscriptionDetails(applicationId, userId, userType, tenantId) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      let result;
      if (userType === "CRM") {
        result = await subscriptionDetailsHandler.deleteByApplicationId(
          applicationId,
          tenantId
        );
      } else {
        result =
          await subscriptionDetailsHandler.deleteByUserIdAndApplicationId(
            userId,
            applicationId,
            tenantId
          );
      }

      return result;
    } catch (error) {
      console.error(
        "SubscriptionDetailsService [deleteSubscriptionDetails] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Check if subscription details exist for application
   * @param {string} applicationId - Application ID
   * @returns {Promise<boolean>} True if exists, false otherwise
   */
  async checkSubscriptionDetailsExist(applicationId, tenantId) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      const details = await subscriptionDetailsHandler.getByApplicationId(
        applicationId,
        tenantId
      );
      return !!details;
    } catch (error) {
      console.error(
        "SubscriptionDetailsService [checkSubscriptionDetailsExist] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Get subscription details by email
   * @param {string} email - Email address
   * @returns {Promise<Object>} Subscription details
   */
  async getSubscriptionDetailsByEmail(email, tenantId) {
    try {
      if (!email) {
        throw AppError.badRequest("Email is required");
      }

      return await subscriptionDetailsHandler.getByEmail(email, tenantId);
    } catch (error) {
      console.error(
        "SubscriptionDetailsService [getSubscriptionDetailsByEmail] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Get my subscription details (for PORTAL users)
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Subscription details
   */
  async getMySubscriptionDetails(userId, tenantId) {
    try {
      if (!userId) {
        throw AppError.badRequest("User ID is required");
      }

      const subscriptionDetails = await subscriptionDetailsHandler.getByUserId(
        userId,
        tenantId
      );
      
      // Return null if not found (consistent with other services)
      // This allows Promise.allSettled to handle it gracefully
      return subscriptionDetails || null;
    } catch (error) {
      console.error(
        "SubscriptionDetailsService [getMySubscriptionDetails] Error:",
        error
      );
      throw error;
    }
  }
}

module.exports = new SubscriptionDetailsService();

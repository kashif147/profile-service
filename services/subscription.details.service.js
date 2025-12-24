const subscriptionDetailsHandler = require("../handlers/subscription.details.handler");
const personalDetailsHandler = require("../handlers/personal.details.handler");
const professionalDetailsHandler = require("../handlers/professional.details.handler");
const { APPLICATION_STATUS } = require("../constants/enums");
const { AppError } = require("../errors/AppError");
const mongoose = require("mongoose");

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
  async createSubscriptionDetails(data, applicationId, userId, userType) {
    try {
      if (!data) {
        throw AppError.badRequest("Subscription details data is required");
      }

      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      // Check if application exists
      const personalDetails = await personalDetailsHandler.getApplicationById(
        applicationId
      );
      if (!personalDetails) {
        throw AppError.notFound("Application not found");
      }

      // Check if subscription details already exist
      const existingDetails =
        await subscriptionDetailsHandler.getByApplicationId(applicationId);
      if (existingDetails) {
        throw AppError.conflict(
          "Subscription details already exist for this application, please update existing details"
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
        await professionalDetailsHandler.getApplicationById(applicationId);
      const membershipCategoryFromProfessional =
        professionalDetails?.professionalDetails?.membershipCategory ?? null;

      const createData = {
        ...data,
        applicationId: applicationId,
        userId: userId,
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

      // Enforce payment frequency rule: Credit Card = Annually, Others = Monthly
      const {
        enforcePaymentFrequencyRule,
      } = require("../helpers/payment.frequency.helper.js");
      createData.subscriptionDetails = enforcePaymentFrequencyRule(
        createData.subscriptionDetails
      );

      const result = await subscriptionDetailsHandler.create(createData);

      // Get membership category from subscription details or professional details
      let membershipCategoryId =
        result?.subscriptionDetails?.membershipCategory ||
        professionalDetails?.professionalDetails?.membershipCategory;

      // Helper function to check if a value is a MongoDB ObjectId
      const isObjectId = (value) => {
        if (!value) return false;
        // Check if it's already a mongoose ObjectId instance
        if (value instanceof mongoose.Types.ObjectId) return true;
        // Check if it's a string that represents a valid ObjectId
        if (typeof value === "string") {
          return mongoose.Types.ObjectId.isValid(value) && value.length === 24;
        }
        return false;
      };

      // If membership category is an ObjectId, fetch the lookup name
      let membershipCategoryName = membershipCategoryId;
      if (isObjectId(membershipCategoryId)) {
        try {
          // Convert to string if it's an ObjectId instance
          const categoryIdString = membershipCategoryId.toString();
          
          // Fetch lookup from database
          // Try to get existing model or create schema if needed
          let Lookup;
          try {
            Lookup = mongoose.model("Lookup");
          } catch (modelError) {
            // Model doesn't exist, create it
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
              { timestamps: true }
            );
            Lookup = mongoose.model("Lookup", lookupSchema);
          }

          const lookup = await Lookup.findById(categoryIdString);
          if (lookup && lookup.lookupname) {
            membershipCategoryName = lookup.lookupname;
            console.log(
              `📋 [PROFILE_SUBSCRIPTION_SERVICE] Resolved membership category ID ${categoryIdString} to name: ${membershipCategoryName}`
            );
          } else {
            console.warn(
              `⚠️ [PROFILE_SUBSCRIPTION_SERVICE] Lookup not found for ID: ${categoryIdString}`
            );
          }
        } catch (lookupError) {
          console.error(
            `❌ [PROFILE_SUBSCRIPTION_SERVICE] Error fetching lookup for ID ${categoryIdString}:`,
            lookupError.message
          );
          // Continue with ID as fallback - won't match "Undergraduate Student" but won't break
        }
      }

      // Check if membership category is "Undergraduate Student"
      const isUndergraduateStudent =
        membershipCategoryName &&
        membershipCategoryName.toLowerCase() === "undergraduate student";

      // Update application status based on userType and membership category:
      // - CRM users: Mark ALL applications as "submitted" immediately (bypass payment flow)
      // - PORTAL users + Undergraduate Student: Mark as "submitted" immediately (no payment required)
      // - PORTAL users + Other categories: Keep as "in-progress" until payment is received
      if (userType === "CRM") {
        console.log(
          "📝 [PROFILE_SUBSCRIPTION_SERVICE] CRM user - updating status to submitted (bypassing payment flow)"
        );
        await personalDetailsHandler.updateApplicationStatus(
          applicationId,
          APPLICATION_STATUS.SUBMITTED
        );
      } else if (userType === "PORTAL" && isUndergraduateStudent) {
        console.log(
          "📝 [PROFILE_SUBSCRIPTION_SERVICE] PORTAL user + Undergraduate Student - updating status to submitted (no payment required)"
        );
        await personalDetailsHandler.updateApplicationStatus(
          applicationId,
          APPLICATION_STATUS.SUBMITTED
        );
      } else if (userType === "PORTAL" && !isUndergraduateStudent) {
        console.log(
          "ℹ️ [PROFILE_SUBSCRIPTION_SERVICE] PORTAL user + Non-Undergraduate Student - keeping status as in-progress until payment is received"
        );
        // Status remains as "in-progress" - will be updated when payment is processed
      } else {
        console.warn(
          `⚠️ [PROFILE_SUBSCRIPTION_SERVICE] Unexpected userType: ${userType}, keeping status unchanged`
        );
      }

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
  async getSubscriptionDetails(applicationId, userId, userType) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      // Validate parent resource: check if application exists
      const personalDetails = await personalDetailsHandler.getApplicationById(
        applicationId
      );
      if (!personalDetails) {
        throw AppError.notFound("Application not found");
      }

      if (userType === "CRM") {
        return await subscriptionDetailsHandler.getApplicationById(
          applicationId
        );
      } else {
        return await subscriptionDetailsHandler.getByUserIdAndApplicationId(
          userId,
          applicationId
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
  async updateSubscriptionDetails(applicationId, updateData, userId, userType) {
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

      // Enforce payment frequency rule if subscriptionDetails are being updated
      if (safeUpdateData.subscriptionDetails) {
        const {
          enforcePaymentFrequencyRule,
        } = require("../helpers/payment.frequency.helper.js");
        safeUpdateData.subscriptionDetails = enforcePaymentFrequencyRule(
          safeUpdateData.subscriptionDetails
        );
      }

      const updatePayload = {
        ...safeUpdateData,
        meta: { updatedBy: userId, userType },
      };

      let result;
      if (userType === "CRM") {
        result = await subscriptionDetailsHandler.updateByApplicationId(
          applicationId,
          updatePayload
        );
      } else {
        result =
          await subscriptionDetailsHandler.updateByUserIdAndApplicationId(
            userId,
            applicationId,
            updatePayload
          );
      }

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
  async deleteSubscriptionDetails(applicationId, userId, userType) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      let result;
      if (userType === "CRM") {
        result = await subscriptionDetailsHandler.deleteByApplicationId(
          applicationId
        );
      } else {
        result =
          await subscriptionDetailsHandler.deleteByUserIdAndApplicationId(
            userId,
            applicationId
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
  async checkSubscriptionDetailsExist(applicationId) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      const details = await subscriptionDetailsHandler.getByApplicationId(
        applicationId
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
  async getSubscriptionDetailsByEmail(email) {
    try {
      if (!email) {
        throw AppError.badRequest("Email is required");
      }

      return await subscriptionDetailsHandler.getByEmail(email);
    } catch (error) {
      console.error(
        "SubscriptionDetailsService [getSubscriptionDetailsByEmail] Error:",
        error
      );
      throw error;
    }
  }
}

module.exports = new SubscriptionDetailsService();

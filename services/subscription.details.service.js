const subscriptionDetailsHandler = require("../handlers/subscription.details.handler");
const personalDetailsHandler = require("../handlers/personal.details.handler");
const { APPLICATION_STATUS } = require("../constants/enums");
const { AppError } = require("../errors/AppError");

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

      const createData = {
        ...data,
        ApplicationId: applicationId,
        userId: userId,
        meta: { createdBy: userId, userType },
      };

      const result = await subscriptionDetailsHandler.create(createData);

      // Update application status to submitted (complete application)
      await personalDetailsHandler.updateApplicationStatus(
        applicationId,
        APPLICATION_STATUS.SUBMITTED
      );

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

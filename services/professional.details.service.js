const professionalDetailsHandler = require("../handlers/professional.details.handler");
const personalDetailsHandler = require("../handlers/personal.details.handler");
const subscriptionDetailsHandler = require("../handlers/subscription.details.handler");
const { AppError } = require("../errors/AppError");
const {
  attachMembershipCategoryToProfessionalData,
  enrichProfessionalWithSubscriptionMembershipCategory,
  professionalPayloadIncludesMigratedFields,
  syncMembershipCategoryToSubscription,
} = require("../helpers/membershipCategory.helper.js");

async function clearLegacyProfessionalFieldsFromSubscription(
  applicationId,
  tenantId,
  professionalPayload = {},
) {
  if (!professionalPayloadIncludesMigratedFields(professionalPayload)) return;
  await subscriptionDetailsHandler.unsetLegacyProfessionalFieldsByApplicationId(
    applicationId,
    tenantId,
  );
}

/**
 * Professional Details Service Layer
 * Contains business logic for professional details operations
 */
class ProfessionalDetailsService {
  /**
   * Create professional details
   * @param {Object} data - Professional details data
   * @param {string} applicationId - Application ID
   * @param {string} userId - User ID
   * @param {string} userType - User type (CRM/PORTAL)
   * @returns {Promise<Object>} Created professional details
   */
  async createProfessionalDetails(
    data,
    applicationId,
    userId,
    userType,
    tenantId,
    membershipCategory = null
  ) {
    try {
      if (!data) {
        throw AppError.badRequest("Professional details data is required");
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

      // Check if professional details already exist
      const existingDetails =
        await professionalDetailsHandler.getByApplicationId(
          applicationId,
          tenantId
        );
      if (existingDetails) {
        throw AppError.conflict(
          "Professional details already exist for this application, please update existing details"
        );
      }

      // Validate user permissions for PORTAL users
      if (userType !== "CRM") {
        if (personalDetails.userId?.toString() !== userId?.toString()) {
          throw AppError.forbidden(
            "Access denied. You can only create professional details for your own applications."
          );
        }
      }

      const createData = attachMembershipCategoryToProfessionalData(
        {
          ...data,
          applicationId: applicationId,
          userId: userId,
          tenantId,
          meta: { createdBy: userId, userType: userType },
        },
        membershipCategory
      );

      const result = await professionalDetailsHandler.create(createData);

      await syncMembershipCategoryToSubscription({
        applicationId,
        membershipCategory,
        userId,
        userType,
        tenantId,
        subscriptionDetailsHandler,
      });

      await clearLegacyProfessionalFieldsFromSubscription(
        applicationId,
        tenantId,
        data?.professionalDetails,
      );

      return result;
    } catch (error) {
      console.error(
        "ProfessionalDetailsService [createProfessionalDetails] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Get professional details by application ID
   * @param {string} applicationId - Application ID
   * @param {string} userId - User ID (for authorization)
   * @param {string} userType - User type (CRM/PORTAL)
   * @returns {Promise<Object>} Professional details
   */
  async getProfessionalDetails(applicationId, userId, userType, tenantId) {
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

      const professionalDetails =
        await professionalDetailsHandler.getByApplicationId(
          applicationId,
          tenantId
        );
      
      // If application exists but professional details don't, return null (will be handled as 200 OK with null)
      if (!professionalDetails) {
        return null;
      }

      const subscriptionDetails =
        await subscriptionDetailsHandler.getByApplicationId(
          applicationId,
          tenantId
        );

      const enriched = await enrichProfessionalWithSubscriptionMembershipCategory(
        professionalDetails,
        subscriptionDetails,
      );
      
      // Validate user permissions for PORTAL users
      if (userType !== "CRM") {
        if (!professionalDetails.userId || professionalDetails.userId.toString() !== userId?.toString()) {
          throw AppError.forbidden(
            "Access denied. You can only view professional details for your own applications."
          );
        }
      }

      return enriched;
    } catch (error) {
      console.error(
        "ProfessionalDetailsService [getProfessionalDetails] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Update professional details
   * @param {string} applicationId - Application ID
   * @param {Object} updateData - Update data
   * @param {string} userId - User ID (for authorization)
   * @param {string} userType - User type (CRM/PORTAL)
   * @returns {Promise<Object>} Updated professional details
   */
  async updateProfessionalDetails(
    applicationId,
    updateData,
    userId,
    userType,
    tenantId,
    membershipCategory = null
  ) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      if (!updateData) {
        throw AppError.badRequest("Update data is required");
      }

      const updatePayload = attachMembershipCategoryToProfessionalData(
        {
          ...updateData,
          "meta.updatedBy": userId,
          "meta.userType": userType,
        },
        membershipCategory
      );

      let result;
      if (userType === "CRM") {
        result = await professionalDetailsHandler.updateByApplicationId(
          applicationId,
          updatePayload,
          tenantId
        );
      } else {
        result =
          await professionalDetailsHandler.updateByUserIdAndApplicationId(
            userId,
            applicationId,
            updatePayload,
            tenantId
          );
      }

      await syncMembershipCategoryToSubscription({
        applicationId,
        membershipCategory,
        userId,
        userType,
        tenantId,
        subscriptionDetailsHandler,
      });

      await clearLegacyProfessionalFieldsFromSubscription(
        applicationId,
        tenantId,
        updateData?.professionalDetails,
      );

      const subscriptionDetails =
        await subscriptionDetailsHandler.getByApplicationId(
          applicationId,
          tenantId,
        );

      return await enrichProfessionalWithSubscriptionMembershipCategory(
        result,
        subscriptionDetails,
      );
    } catch (error) {
      console.error(
        "ProfessionalDetailsService [updateProfessionalDetails] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Delete professional details
   * @param {string} applicationId - Application ID
   * @param {string} userId - User ID (for authorization)
   * @param {string} userType - User type (CRM/PORTAL)
   * @returns {Promise<Object>} Deleted professional details
   */
  async deleteProfessionalDetails(applicationId, userId, userType, tenantId) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      let result;
      if (userType === "CRM") {
        result = await professionalDetailsHandler.deleteByApplicationId(
          applicationId,
          tenantId
        );
      } else {
        result =
          await professionalDetailsHandler.deleteByUserIdAndApplicationId(
            userId,
            applicationId,
            tenantId
          );
      }

      return result;
    } catch (error) {
      console.error(
        "ProfessionalDetailsService [deleteProfessionalDetails] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Get professional details for portal user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Professional details
   */
  async getMyProfessionalDetails(userId, tenantId) {
    try {
      if (!userId) {
        throw AppError.badRequest("User ID is required");
      }

      const professionalDetails = await professionalDetailsHandler.getByUserId(
        userId,
        tenantId
      );
      if (!professionalDetails) return null;

      const subscriptionDetails = professionalDetails.applicationId
        ? await subscriptionDetailsHandler.getByApplicationId(
            professionalDetails.applicationId,
            tenantId
          )
        : null;

      return await enrichProfessionalWithSubscriptionMembershipCategory(
        professionalDetails,
        subscriptionDetails,
      );
    } catch (error) {
      console.error(
        "ProfessionalDetailsService [getMyProfessionalDetails] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Check if professional details exist for application
   * @param {string} applicationId - Application ID
   * @returns {Promise<boolean>} True if exists, false otherwise
   */
  async checkProfessionalDetailsExist(applicationId, tenantId) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      const details = await professionalDetailsHandler.getByApplicationId(
        applicationId,
        tenantId
      );
      return !!details;
    } catch (error) {
      console.error(
        "ProfessionalDetailsService [checkProfessionalDetailsExist] Error:",
        error
      );
      throw error;
    }
  }
}

module.exports = new ProfessionalDetailsService();

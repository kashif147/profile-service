const professionalDetailsHandler = require("../handlers/professional.details.handler");
const personalDetailsHandler = require("../handlers/personal.details.handler");
const { AppError } = require("../errors/AppError");

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
  async createProfessionalDetails(data, applicationId, userId, userType) {
    try {
      if (!data) {
        throw AppError.badRequest("Professional details data is required");
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

      // Check if professional details already exist
      const existingDetails =
        await professionalDetailsHandler.getByApplicationId(applicationId);
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

      const createData = {
        ...data,
        applicationId: applicationId,
        userId: userId,
        meta: { createdBy: userId, userType: userType },
      };

      return await professionalDetailsHandler.create(createData);
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
  async getProfessionalDetails(applicationId, userId, userType) {
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

      const professionalDetails = await professionalDetailsHandler.getApplicationById(applicationId);
      
      // If application exists but professional details don't, return null (will be handled as 200 OK with null)
      if (!professionalDetails) {
        return null;
      }
      
      // Validate user permissions for PORTAL users
      if (userType !== "CRM") {
        if (!professionalDetails.userId || professionalDetails.userId.toString() !== userId?.toString()) {
          throw AppError.forbidden(
            "Access denied. You can only view professional details for your own applications."
          );
        }
      }

      return professionalDetails;
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
  async updateProfessionalDetails(applicationId, updateData, userId, userType) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      if (!updateData) {
        throw AppError.badRequest("Update data is required");
      }

      const updatePayload = {
        ...updateData,
        meta: { updatedBy: userId, userType },
      };

      let result;
      if (userType === "CRM") {
        result = await professionalDetailsHandler.updateByApplicationId(
          applicationId,
          updatePayload
        );
      } else {
        result =
          await professionalDetailsHandler.updateByUserIdAndApplicationId(
            userId,
            applicationId,
            updatePayload
          );
      }

      return result;
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
  async deleteProfessionalDetails(applicationId, userId, userType) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      let result;
      if (userType === "CRM") {
        result = await professionalDetailsHandler.deleteByApplicationId(
          applicationId
        );
      } else {
        result =
          await professionalDetailsHandler.deleteByUserIdAndApplicationId(
            userId,
            applicationId
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
  async getMyProfessionalDetails(userId) {
    try {
      if (!userId) {
        throw AppError.badRequest("User ID is required");
      }

      return await professionalDetailsHandler.getByUserId(userId);
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
  async checkProfessionalDetailsExist(applicationId) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      const details = await professionalDetailsHandler.getByApplicationId(
        applicationId
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

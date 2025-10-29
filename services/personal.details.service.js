const personalDetailsHandler = require("../handlers/personal.details.handler");
const { AppError } = require("../errors/AppError");

/**
 * Personal Details Service Layer
 * Contains business logic for personal details operations
 */
class PersonalDetailsService {
  /**
   * Create personal details
   * @param {Object} data - Personal details data
   * @returns {Promise<Object>} Created personal details
   */
  async createPersonalDetails(data) {
    try {
      if (!data) {
        throw AppError.badRequest("Personal details data is required");
      }

      return await personalDetailsHandler.create(data);
    } catch (error) {
      console.error(
        "PersonalDetailsService [createPersonalDetails] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Get personal details by application ID
   * @param {string} applicationId - Application ID
   * @param {string} userId - User ID (for authorization)
   * @param {string} userType - User type (CRM/PORTAL)
   * @returns {Promise<Object>} Personal details
   */
  async getPersonalDetails(applicationId, userId, userType) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      if (!userType) {
        throw AppError.badRequest("User type is required");
      }

      let personalDetails;
      if (userType === "CRM") {
        personalDetails = await personalDetailsHandler.getApplicationById(applicationId);
      } else if (userType === "PORTAL") {
        if (!userId) {
          throw AppError.badRequest("User ID is required for portal users");
        }
        personalDetails = await personalDetailsHandler.getByUserIdAndApplicationId(
          userId,
          applicationId
        );
      } else {
        throw AppError.badRequest(`Invalid user type: ${userType}. Expected PORTAL or CRM.`);
      }

      if (!personalDetails) {
        throw new Error("Personal details not found");
      }

      return personalDetails;
    } catch (error) {
      console.error(
        "PersonalDetailsService [getPersonalDetails] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Update personal details
   * @param {string} applicationId - Application ID
   * @param {Object} updateData - Update data
   * @param {string} userId - User ID (for authorization)
   * @param {string} userType - User type (CRM/PORTAL)
   * @returns {Promise<Object>} Updated personal details
   */
  async updatePersonalDetails(applicationId, updateData, userId, userType) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      if (!updateData) {
        throw AppError.badRequest("Update data is required");
      }

      let result;
      if (userType === "CRM") {
        result = await personalDetailsHandler.updateByApplicationId(
          applicationId,
          updateData
        );
      } else {
        result = await personalDetailsHandler.updateByUserIdAndApplicationId(
          userId,
          applicationId,
          updateData
        );
      }

      return result;
    } catch (error) {
      console.error(
        "PersonalDetailsService [updatePersonalDetails] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Delete personal details
   * @param {string} applicationId - Application ID
   * @param {string} userId - User ID (for authorization)
   * @param {string} userType - User type (CRM/PORTAL)
   * @returns {Promise<Object>} Deleted personal details
   */
  async deletePersonalDetails(applicationId, userId, userType) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      let result;
      if (userType === "CRM") {
        result = await personalDetailsHandler.deleteByApplicationId(
          applicationId
        );
      } else {
        result = await personalDetailsHandler.deleteByUserIdAndApplicationId(
          userId,
          applicationId
        );
      }

      return result;
    } catch (error) {
      console.error(
        "PersonalDetailsService [deletePersonalDetails] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Get personal details for portal user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Personal details
   */
  async getMyPersonalDetails(userId) {
    try {
      if (!userId) {
        throw AppError.badRequest("User ID is required");
      }

      return await personalDetailsHandler.getByUserIdForPortal(userId);
    } catch (error) {
      console.error(
        "PersonalDetailsService [getMyPersonalDetails] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Check if personal details exist for user
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} True if exists, false otherwise
   */
  async checkPersonalDetailsExist(userId) {
    try {
      if (!userId) {
        throw AppError.badRequest("User ID is required");
      }

      const details = await personalDetailsHandler.getByUserId(userId);
      return !!details;
    } catch (error) {
      console.error(
        "PersonalDetailsService [checkPersonalDetailsExist] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Get application status by application ID
   * @param {string} applicationId - Application ID
   * @param {string} userId - User ID (for authorization)
   * @param {string} userType - User type (CRM/PORTAL)
   * @returns {Promise<string>} Application status
   */
  async getApplicationStatus(applicationId, userId, userType) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      let personalDetails;
      if (userType === "CRM") {
        personalDetails = await personalDetailsHandler.getApplicationById(
          applicationId
        );
      } else {
        personalDetails =
          await personalDetailsHandler.getByUserIdAndApplicationId(
            userId,
            applicationId
          );
      }

      if (!personalDetails) {
        throw new Error("Personal details not found");
      }

      return personalDetails.applicationStatus;
    } catch (error) {
      console.error(
        "PersonalDetailsService [getApplicationStatus] Error:",
        error
      );
      throw error;
    }
  }
}

module.exports = new PersonalDetailsService();

const applicationHandler = require("../handlers/application.handler");
const { AppError } = require("../errors/AppError");

/**
 * Application Service Layer
 * Contains business logic for application operations
 */
class ApplicationService {
  /**
   * Get all applications with optional status filtering
   * @param {Array} statusFilters - Array of status values to filter by
   * @returns {Promise<Array>} Array of applications
   */
  async getAllApplications(statusFilters = []) {
    try {
      return await applicationHandler.getAllApplications(statusFilters);
    } catch (error) {
      console.error("ApplicationService [getAllApplications] Error:", error);
      throw error;
    }
  }

  /**
   * Get application by ID with details
   * @param {string} applicationId - Application ID
   * @returns {Promise<Object>} Application details
   */
  async getApplicationById(applicationId) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      return await applicationHandler.getApplicationById(applicationId);
    } catch (error) {
      console.error("ApplicationService [getApplicationById] Error:", error);
      throw error;
    }
  }

  /**
   * Update application status (approve/reject)
   * @param {string} applicationId - Application ID
   * @param {string} newStatus - New status (approved/rejected)
   * @param {string} approvedBy - User ID who approved/rejected
   * @param {string} comments - Comments for the decision
   * @returns {Promise<Object>} Updated application
   */
  async updateApplicationStatus(
    applicationId,
    newStatus,
    approvedBy,
    comments
  ) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      if (!newStatus) {
        throw AppError.badRequest("Application status is required");
      }

      if (!approvedBy) {
        throw AppError.badRequest("Approver ID is required");
      }

      // Validate status
      const validStatuses = ["approved", "rejected", "pending"];
      if (!validStatuses.includes(newStatus)) {
        throw AppError.badRequest(
          `Invalid status. Must be one of: ${validStatuses.join(", ")}`
        );
      }

      return await applicationHandler.updateApplicationStatus(
        applicationId,
        newStatus,
        approvedBy,
        comments
      );
    } catch (error) {
      console.error(
        "ApplicationService [updateApplicationStatus] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Get applications with complete details (personal, professional, subscription)
   * @param {Array} statusFilters - Array of status values to filter by
   * @returns {Promise<Array>} Array of applications with complete details
   */
  async getAllApplicationsWithDetails(statusFilters = []) {
    try {
      return await applicationHandler.getAllApplicationsWithDetails(
        statusFilters
      );
    } catch (error) {
      console.error(
        "ApplicationService [getAllApplicationsWithDetails] Error:",
        error
      );
      throw error;
    }
  }

  /**
   * Get application with complete details by ID
   * @param {string} applicationId - Application ID
   * @returns {Promise<Object>} Application with complete details
   */
  async getApplicationWithDetails(applicationId) {
    try {
      if (!applicationId) {
        throw AppError.badRequest("Application ID is required");
      }

      return await applicationHandler.getApplicationWithDetails(applicationId);
    } catch (error) {
      console.error(
        "ApplicationService [getApplicationWithDetails] Error:",
        error
      );
      throw error;
    }
  }
}

module.exports = new ApplicationService();

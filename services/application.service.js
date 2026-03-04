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

      // Normalize status to lowercase for consistency
      const normalizedStatus = newStatus?.toLowerCase();

      // Validate status
      const validStatuses = ["approved", "rejected", "pending"];
      if (!validStatuses.includes(normalizedStatus)) {
        throw AppError.badRequest(
          `Invalid status. Must be one of: ${validStatuses.join(", ")}`
        );
      }

      return await applicationHandler.updateApplicationStatus(
        applicationId,
        normalizedStatus,
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
   * @param {number} page - Page number (default: 1)
   * @param {number} limit - Number of items per page (default: 10)
   * @returns {Promise<Object>} Object containing applications array and pagination metadata
   */
  async getAllApplicationsWithDetails(statusFilters = [], page = 1, limit = 10) {
    try {
      return await applicationHandler.getAllApplicationsWithDetails(
        statusFilters,
        page,
        limit
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
   * NEW METHOD - Get applications with template-based filters and columns
   * Used by the PUT API for template-based filtering
   * @param {Object} filters - Filters keyed by model field names (applicationStatus, membershipCategory). Each: { operator: "equal_to"|"not_equal_to", values: string[] }
   * @param {number} page - Page number (default: 1)
   * @param {number} limit - Number of items per page (default: 10)
   * @param {Array} columns - Array of field names to include in response (empty = all fields)
   * @returns {Promise<Object>} Object containing applications array and pagination metadata
   */
  async getApplicationsWithTemplateFilters(filters = {}, page = 1, limit = 10, columns = []) {
    try {
      return await applicationHandler.getApplicationsWithTemplateFilters(
        filters,
        page,
        limit,
        columns
      );
    } catch (error) {
      console.error(
        "ApplicationService [getApplicationsWithTemplateFilters] Error:",
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

  /**
   * Get applications by profile ID
   * @param {string} profileId - Profile ID
   * @param {Array} [statusFilters] - Optional array of application status values to filter by (e.g. ["approved", "submitted"])
   * @returns {Promise<Array>} Array of applications with summary details
   */
  async getApplicationsByProfileId(profileId, statusFilters = []) {
    try {
      if (!profileId) {
        throw AppError.badRequest("Profile ID is required");
      }

      return await applicationHandler.getApplicationsByProfileId(profileId, statusFilters);
    } catch (error) {
      console.error(
        "ApplicationService [getApplicationsByProfileId] Error:",
        error
      );
      throw error;
    }
  }
}

module.exports = new ApplicationService();

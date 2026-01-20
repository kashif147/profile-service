const PersonalDetails = require("../models/personal.details.model");
const ProfessionalDetails = require("../models/professional.details.model");
const SubscriptionDetails = require("../models/subscription.model");
const { APPLICATION_STATUS } = require("../constants/enums");
// membership number generation moved to Profile creation flow

exports.getAllApplications = (statusFilters = []) =>
  new Promise(async (resolve, reject) => {
    try {
      let query = {};

      // If status filters are provided, filter by them
      // Normalize to lowercase to handle both cases
      if (statusFilters && statusFilters.length > 0) {
        const normalizedFilters = statusFilters.map(filter => 
          typeof filter === 'string' ? filter.toLowerCase() : filter
        );
        query.applicationStatus = { $in: normalizedFilters };
      }

      const applications = await PersonalDetails.find(query).sort({
        createdAt: -1,
      });

      resolve(applications);
    } catch (error) {
      console.error("ApplicationHandler [getAllApplications] Error:", error);
      reject(error);
    }
  });

exports.getApplicationById = (applicationId) =>
  new Promise(async (resolve, reject) => {
    try {
      const application = await PersonalDetails.findOne({
        applicationId: applicationId,
      })
        .populate("userId", "name email")
        .populate("approvalDetails.approvedBy", "name email");

      if (!application) {
        reject(new Error("Application not found"));
        return;
      }

      resolve(application);
    } catch (error) {
      console.error("ApplicationHandler [getApplicationById] Error:", error);
      reject(error);
    }
  });

exports.updateApplicationStatus = (
  applicationId,
  newStatus,
  approvedBy,
  comments
) =>
  new Promise(async (resolve, reject) => {
    try {
      // Normalize status to lowercase to ensure consistency
      const normalizedStatus = newStatus?.toLowerCase();
      const updateData = {
        applicationStatus: normalizedStatus,
        approvalDetails: {
          approvedBy: approvedBy,
          approvedAt: new Date(),
          comments: comments || "",
        },
      };

      const result = await PersonalDetails.findOneAndUpdate(
        { applicationId: applicationId },
        updateData,
        { new: true, runValidators: true }
      );

      if (!result) {
        reject(new Error("Application not found"));
        return;
      }

      // Membership number is generated only when a new Profile is created

      resolve(result);
    } catch (error) {
      console.error(
        "ApplicationHandler [updateApplicationStatus] Error:",
        error
      );
      reject(error);
    }
  });

exports.getApplicationWithDetails = (applicationId) =>
  new Promise(async (resolve, reject) => {
    try {
      const [personalDetails, professionalDetails, subscriptionDetails] =
        await Promise.all([
          PersonalDetails.findOne({ applicationId: applicationId }),
          ProfessionalDetails.findOne({ applicationId: applicationId }),
          SubscriptionDetails.findOne({ applicationId: applicationId }),
        ]);

      if (!personalDetails) {
        reject(new Error("Application not found"));
        return;
      }

      const membershipCategory =
        subscriptionDetails?.subscriptionDetails?.membershipCategory ??
        professionalDetails?.professionalDetails?.membershipCategory ??
        null;

      const professionalPayload = professionalDetails
        ? {
            ...professionalDetails.professionalDetails,
            membershipCategory,
          }
        : membershipCategory !== null
        ? { membershipCategory }
        : null;

      const subscriptionPayload = subscriptionDetails
        ? {
            ...subscriptionDetails.subscriptionDetails,
            membershipCategory:
              subscriptionDetails.subscriptionDetails?.membershipCategory ??
              membershipCategory,
          }
        : membershipCategory !== null
        ? { membershipCategory }
        : null;

      const applicationDetails = {
        applicationId: personalDetails.applicationId,
        userId: personalDetails.userId,
        membershipNumber: subscriptionDetails
          ? subscriptionDetails.membershipNumber
          : null,
        personalDetails: personalDetails,
        professionalDetails: professionalPayload,
        subscriptionDetails: subscriptionPayload,
        applicationStatus: personalDetails.applicationStatus,
        approvalDetails: personalDetails.approvalDetails,
        createdAt: personalDetails.createdAt,
        updatedAt: personalDetails.updatedAt,
      };

      resolve(applicationDetails);
    } catch (error) {
      console.error(
        "ApplicationHandler [getApplicationWithDetails] Error:",
        error
      );
      reject(error);
    }
  });

// Original method - unchanged, returns all fields
exports.getAllApplicationsWithDetails = (statusFilters = [], page = 1, limit = 10) =>
  new Promise(async (resolve, reject) => {
    try {
      let query = {};

      if (statusFilters && statusFilters.length > 0) {
        query.applicationStatus = { $in: statusFilters };
      }

      // Calculate pagination
      const skip = (page - 1) * limit;

      // Get total count for pagination metadata
      const totalCount = await PersonalDetails.countDocuments(query);

      // Get paginated applications
      const applications = await PersonalDetails.find(query)
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit);

      const applicationsWithDetails = await Promise.all(
        applications.map(async (application) => {
          try {
            const [professionalDetails, subscriptionDetails] =
              await Promise.all([
                ProfessionalDetails.findOne({
                  applicationId: application.applicationId,
                }),
                SubscriptionDetails.findOne({
                  applicationId: application.applicationId,
                }),
              ]);

            const membershipCategory =
              subscriptionDetails?.subscriptionDetails?.membershipCategory ??
              professionalDetails?.professionalDetails?.membershipCategory ??
              null;

            const professionalPayload = professionalDetails
              ? {
                  ...professionalDetails.professionalDetails,
                  membershipCategory,
                }
              : membershipCategory !== null
              ? { membershipCategory }
              : null;

            const subscriptionPayload = subscriptionDetails
              ? {
                  ...subscriptionDetails.subscriptionDetails,
                  membershipCategory:
                    subscriptionDetails.subscriptionDetails
                      ?.membershipCategory ?? membershipCategory,
                }
              : membershipCategory !== null
              ? { membershipCategory }
              : null;

            return {
              applicationId: application.applicationId,
              userId: application.userId,
              membershipNumber: subscriptionDetails
                ? subscriptionDetails.membershipNumber
                : null,
              personalDetails: application,
              professionalDetails: professionalPayload,
              subscriptionDetails: subscriptionPayload,
              applicationStatus: application.applicationStatus,
              approvalDetails: application.approvalDetails,
              createdAt: application.createdAt,
              updatedAt: application.updatedAt,
            };
          } catch (error) {
            console.error("Error fetching details for application:", error);
            return null;
          }
        })
      );

      // Filter out null values (from errors)
      const filteredApplications = applicationsWithDetails.filter(app => app !== null);

      resolve({
        applications: filteredApplications,
        pagination: {
          page: page,
          limit: limit,
          totalCount: totalCount,
          totalPages: Math.ceil(totalCount / limit),
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPreviousPage: page > 1,
        },
      });
    } catch (error) {
      console.error(
        "ApplicationHandler [getAllApplicationsWithDetails] Error:",
        error
      );
      reject(error);
    }
  });

/**
 * NEW METHOD - Helper function to filter object by specified columns
 * Supports nested fields like "personalDetails.personalInfo.name"
 */
const filterByColumns = (obj, columns) => {
  // If no columns specified, return all fields
  if (!columns || columns.length === 0) {
    return obj;
  }

  const result = {};

  columns.forEach((column) => {
    const parts = column.split(".");
    let current = obj;
    let resultCurrent = result;

    // Navigate through nested structure
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (i === parts.length - 1) {
        // Last part - set the value
        if (current && current[part] !== undefined) {
          resultCurrent[part] = current[part];
        }
      } else {
        // Intermediate part - create nested structure
        if (current && current[part] !== undefined) {
          if (!resultCurrent[part]) {
            resultCurrent[part] = {};
          }
          current = current[part];
          resultCurrent = resultCurrent[part];
        } else {
          break;
        }
      }
    }
  });

  return result;
};

/**
 * NEW METHOD - Get applications with template filters and column filtering
 * Completely separate from getAllApplicationsWithDetails
 * Used exclusively by the PUT API
 */
exports.getApplicationsWithTemplateFilters = (statusFilters = [], page = 1, limit = 10, columns = []) =>
  new Promise(async (resolve, reject) => {
    try {
      let query = {};

      if (statusFilters && statusFilters.length > 0) {
        query.applicationStatus = { $in: statusFilters };
      }

      // Calculate pagination
      const skip = (page - 1) * limit;

      // Get total count for pagination metadata
      const totalCount = await PersonalDetails.countDocuments(query);

      // Get paginated applications
      const applications = await PersonalDetails.find(query)
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit);

      const applicationsWithDetails = await Promise.all(
        applications.map(async (application) => {
          try {
            const [professionalDetails, subscriptionDetails] =
              await Promise.all([
                ProfessionalDetails.findOne({
                  applicationId: application.applicationId,
                }),
                SubscriptionDetails.findOne({
                  applicationId: application.applicationId,
                }),
              ]);

            const membershipCategory =
              subscriptionDetails?.subscriptionDetails?.membershipCategory ??
              professionalDetails?.professionalDetails?.membershipCategory ??
              null;

            const professionalPayload = professionalDetails
              ? {
                  ...professionalDetails.professionalDetails,
                  membershipCategory,
                }
              : membershipCategory !== null
              ? { membershipCategory }
              : null;

            const subscriptionPayload = subscriptionDetails
              ? {
                  ...subscriptionDetails.subscriptionDetails,
                  membershipCategory:
                    subscriptionDetails.subscriptionDetails
                      ?.membershipCategory ?? membershipCategory,
                }
              : membershipCategory !== null
              ? { membershipCategory }
              : null;

            const fullApplication = {
              applicationId: application.applicationId,
              userId: application.userId,
              membershipNumber: subscriptionDetails
                ? subscriptionDetails.membershipNumber
                : null,
              personalDetails: application,
              professionalDetails: professionalPayload,
              subscriptionDetails: subscriptionPayload,
              applicationStatus: application.applicationStatus,
              approvalDetails: application.approvalDetails,
              createdAt: application.createdAt,
              updatedAt: application.updatedAt,
            };

            // Apply column filtering based on template
            return filterByColumns(fullApplication, columns);
          } catch (error) {
            console.error("Error fetching details for application:", error);
            return null;
          }
        })
      );

      // Filter out null values (from errors)
      const filteredApplications = applicationsWithDetails.filter(app => app !== null);

      resolve({
        applications: filteredApplications,
        pagination: {
          page: page,
          limit: limit,
          totalCount: totalCount,
          totalPages: Math.ceil(totalCount / limit),
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPreviousPage: page > 1,
        },
      });
    } catch (error) {
      console.error(
        "ApplicationHandler [getApplicationsWithTemplateFilters] Error:",
        error
      );
      reject(error);
    }
  });

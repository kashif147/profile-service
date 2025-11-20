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
      if (statusFilters && statusFilters.length > 0) {
        query.applicationStatus = { $in: statusFilters };
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
      const updateData = {
        applicationStatus: newStatus,
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

exports.getAllApplicationsWithDetails = (statusFilters = []) =>
  new Promise(async (resolve, reject) => {
    try {
      let query = {};

      if (statusFilters && statusFilters.length > 0) {
        query.applicationStatus = { $in: statusFilters };
      }

      const applications = await PersonalDetails.find(query).sort({
        createdAt: -1,
      });

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

      resolve(applicationsWithDetails);
    } catch (error) {
      console.error(
        "ApplicationHandler [getAllApplicationsWithDetails] Error:",
        error
      );
      reject(error);
    }
  });

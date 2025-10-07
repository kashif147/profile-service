const PersonalDetails = require("../models/personal.details.model");
const ProfessionalDetails = require("../models/professional.details.model");
const SubscriptionDetails = require("../models/subscription.model");
const { APPLICATION_STATUS } = require("../constants/enums");
const {
  generateMembershipNumber,
} = require("../helpers/membership.number.generator");

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
        ApplicationId: applicationId,
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
        { ApplicationId: applicationId },
        updateData,
        { new: true, runValidators: true }
      );

      if (!result) {
        reject(new Error("Application not found"));
        return;
      }

      // If application is approved, generate membership number
      if (newStatus === APPLICATION_STATUS.APPROVED) {
        try {
          // Find the subscription details for this application
          const subscriptionDetails = await SubscriptionDetails.findOne({
            ApplicationId: applicationId,
          });

          if (subscriptionDetails) {
            // Generate membership number
            const membershipNumber = await generateMembershipNumber();

            // Update subscription with membership number
            await SubscriptionDetails.findOneAndUpdate(
              { ApplicationId: applicationId },
              { membershipNumber: membershipNumber },
              { new: true }
            );
          }
        } catch (error) {
          console.error("Error generating membership number:", error);
          // Don't fail the approval process if membership number generation fails
        }
      }

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
          PersonalDetails.findOne({ ApplicationId: applicationId }),
          ProfessionalDetails.findOne({ ApplicationId: applicationId }),
          SubscriptionDetails.findOne({ ApplicationId: applicationId }),
        ]);

      if (!personalDetails) {
        reject(new Error("Application not found"));
        return;
      }

      const applicationDetails = {
        applicationId: personalDetails.ApplicationId,
        userId: personalDetails.userId,
        membershipNumber: subscriptionDetails
          ? subscriptionDetails.membershipNumber
          : null,
        personalDetails: personalDetails,
        professionalDetails: professionalDetails
          ? professionalDetails.professionalDetails
          : null,
        subscriptionDetails: subscriptionDetails
          ? subscriptionDetails.subscriptionDetails
          : null,
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
                  ApplicationId: application.ApplicationId,
                }),
                SubscriptionDetails.findOne({
                  ApplicationId: application.ApplicationId,
                }),
              ]);

            return {
              ApplicationId: application.ApplicationId,
              userId: application.userId,
              membershipNumber: subscriptionDetails
                ? subscriptionDetails.membershipNumber
                : null,
              personalDetails: application,
              professionalDetails: professionalDetails
                ? professionalDetails.professionalDetails
                : null,
              subscriptionDetails: subscriptionDetails
                ? subscriptionDetails.subscriptionDetails
                : null,
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

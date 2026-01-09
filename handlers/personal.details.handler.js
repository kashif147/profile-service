const PersonalDetails = require("../models/personal.details.model");

exports.create = (data) =>
  new Promise(async (resolve, reject) => {
    try {
      // Age calculation and date conversion
      if (data.personalInfo?.dateOfBirth) {
        let dob;

        // If it's already a Date object (from Joi.date().iso())
        if (data.personalInfo.dateOfBirth instanceof Date) {
          dob = data.personalInfo.dateOfBirth;
        } else {
          // If it's a string, check format
          const dateStr = data.personalInfo.dateOfBirth.toString();
          if (dateStr.includes("/")) {
            dob = new Date(dateStr.split("/").reverse().join("-"));
          } else {
            // ISO format
            dob = new Date(dateStr);
          }
        }

        data.personalInfo.dateOfBirth = dob;
        data.personalInfo.age = new Date().getFullYear() - dob.getFullYear();
      }

      // Convert deceasedDate if present
      if (data.personalInfo?.deceasedDate) {
        let deceasedDate;

        // If it's already a Date object (from Joi.date().iso())
        if (data.personalInfo.deceasedDate instanceof Date) {
          deceasedDate = data.personalInfo.deceasedDate;
        } else {
          // If it's a string, check format
          const dateStr = data.personalInfo.deceasedDate.toString();
          if (dateStr.includes("/")) {
            deceasedDate = new Date(dateStr.split("/").reverse().join("-"));
          } else {
            // ISO format
            deceasedDate = new Date(dateStr);
          }
        }

        data.personalInfo.deceasedDate = deceasedDate;
      }

      // Address formatting
      if (data.contactInfo) {
        const fullAddress = [
          data.contactInfo.buildingOrHouse,
          data.contactInfo.streetOrRoad,
          data.contactInfo.areaOrTown,
          data.contactInfo.countyCityOrPostCode,
          data.contactInfo.country,
        ]
          .filter(Boolean)
          .join(", ");
        data.contactInfo.fullAddress = fullAddress;
      }

      const record = await PersonalDetails.create(data);
      resolve(record);
    } catch (error) {
      console.error("PersonalDetailsHandler [create] Error:", error);
      reject(error);
    }
  });

exports.getByUserId = (userId) =>
  new Promise(async (resolve, reject) => {
    try {
      const result = await PersonalDetails.findOne({ userId });
      resolve(result);
    } catch (error) {
      console.error("PersonalDetailsHandler [getByUserId] Error:", error);
      reject(error);
    }
  });

exports.getByEmail = (email) =>
  new Promise(async (resolve, reject) => {
    try {
      // Normalize email for case-insensitive comparison
      const normalizedEmail = email.toLowerCase().trim();
      const result = await PersonalDetails.findOne({
        $or: [
          { "contactInfo.personalEmail": new RegExp(`^${normalizedEmail}$`, "i") },
          { "contactInfo.workEmail": new RegExp(`^${normalizedEmail}$`, "i") },
        ],
        "meta.deleted": { $ne: true },
      });
      resolve(result);
    } catch (error) {
      console.error("PersonalDetailsHandler [getByEmail] Error:", error);
      reject(error);
    }
  });

exports.getApplicationById = (applicationId) =>
  new Promise(async (resolve, reject) => {
    try {
      // Try lowercase first, then uppercase for backward compatibility
      let result = await PersonalDetails.findOne({
        applicationId: applicationId,
      });
      
      if (!result) {
        result = await PersonalDetails.findOne({
          ApplicationId: applicationId,
        });
      }
      
      resolve(result);
    } catch (error) {
      console.error(
        "PersonalDetailsHandler [getApplicationById] Error:",
        error
      );
      reject(error);
    }
  });

exports.getByUserIdAndApplicationId = (userId, applicationId) =>
  new Promise(async (resolve, reject) => {
    try {
      // Try lowercase first, then uppercase for backward compatibility
      let result = await PersonalDetails.findOne({
        userId: userId,
        applicationId: applicationId,
      });
      
      if (!result) {
        result = await PersonalDetails.findOne({
          userId: userId,
          ApplicationId: applicationId,
        });
      }
      
      resolve(result);
    } catch (error) {
      console.error(
        "PersonalDetailsHandler [getByUserIdAndApplicationId] Error:",
        error
      );
      reject(error);
    }
  });

exports.updateByApplicationId = (applicationId, updateData) =>
  new Promise(async (resolve, reject) => {
    try {
      // Try lowercase first, then uppercase for backward compatibility
      let record = await PersonalDetails.findOneAndUpdate(
        { applicationId: applicationId },
        updateData,
        {
          new: true,
          runValidators: true,
        }
      );
      
      if (!record) {
        record = await PersonalDetails.findOneAndUpdate(
          { ApplicationId: applicationId },
          updateData,
          {
            new: true,
            runValidators: true,
          }
        );
      }
      
      if (!record) return reject(new Error("Personal details not found"));
      resolve(record);
    } catch (error) {
      console.error(
        "PersonalDetailsHandler [updateByApplicationId] Error:",
        error
      );
      reject(error);
    }
  });

exports.updateByUserIdAndApplicationId = (userId, applicationId, updateData) =>
  new Promise(async (resolve, reject) => {
    try {
      // Try lowercase first, then uppercase for backward compatibility
      let record = await PersonalDetails.findOneAndUpdate(
        { userId: userId, applicationId: applicationId },
        updateData,
        {
          new: true,
          runValidators: true,
        }
      );
      
      if (!record) {
        record = await PersonalDetails.findOneAndUpdate(
          { userId: userId, ApplicationId: applicationId },
          updateData,
          {
            new: true,
            runValidators: true,
          }
        );
      }
      
      if (!record) return reject(new Error("Personal details not found"));
      resolve(record);
    } catch (error) {
      console.error(
        "PersonalDetailsHandler [updateByUserIdAndApplicationId] Error:",
        error
      );
      reject(error);
    }
  });

exports.deleteByApplicationId = (applicationId) =>
  new Promise(async (resolve, reject) => {
    try {
      // Try lowercase first, then uppercase for backward compatibility
      let record = await PersonalDetails.findOneAndDelete({
        applicationId: applicationId,
      });
      
      if (!record) {
        record = await PersonalDetails.findOneAndDelete({
          ApplicationId: applicationId,
        });
      }
      
      if (!record) return reject(new Error("Personal details not found"));
      resolve(record);
    } catch (error) {
      console.error(
        "PersonalDetailsHandler [deleteByApplicationId] Error:",
        error
      );
      reject(error);
    }
  });

exports.deleteByUserIdAndApplicationId = (userId, applicationId) =>
  new Promise(async (resolve, reject) => {
    try {
      // Try lowercase first, then uppercase for backward compatibility
      let record = await PersonalDetails.findOneAndDelete({
        userId: userId,
        applicationId: applicationId,
      });
      
      if (!record) {
        record = await PersonalDetails.findOneAndDelete({
          userId: userId,
          ApplicationId: applicationId,
        });
      }
      
      if (!record) return reject(new Error("Personal details not found"));
      resolve(record);
    } catch (error) {
      console.error(
        "PersonalDetailsHandler [deleteByUserIdAndApplicationId] Error:",
        error
      );
      reject(error);
    }
  });

exports.updateApplicationStatus = (applicationId, status) =>
  new Promise(async (resolve, reject) => {
    try {
      // Try lowercase first, then uppercase for backward compatibility
      let result = await PersonalDetails.findOneAndUpdate(
        { applicationId: applicationId },
        { applicationStatus: status },
        { new: true }
      );
      
      if (!result) {
        result = await PersonalDetails.findOneAndUpdate(
          { ApplicationId: applicationId },
          { applicationStatus: status },
          { new: true }
        );
      }
      
      resolve(result);
    } catch (error) {
      console.error(
        "PersonalDetailsHandler [updateApplicationStatus] Error:",
        error
      );
      reject(error);
    }
  });

exports.getByUserIdForPortal = (userId) =>
  new Promise(async (resolve, reject) => {
    try {
      const result = await PersonalDetails.findOne({
        userId: userId,
        "meta.userType": "PORTAL",
      });
      resolve(result);
    } catch (error) {
      console.error(
        "PersonalDetailsHandler [getByUserIdForPortal] Error:",
        error
      );
      reject(error);
    }
  });

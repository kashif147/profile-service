const PersonalDetails = require("../models/personal.details.model");
const { APPLICATION_STATUS } = require("../constants/enums");

const generateFullAddress = (contactInfo) => {
  if (!contactInfo) return "";
  
  const parts = [];
  
  if (contactInfo.buildingOrHouse?.trim()) {
    parts.push(contactInfo.buildingOrHouse.trim());
  }
  
  if (contactInfo.streetOrRoad?.trim()) {
    parts.push(contactInfo.streetOrRoad.trim());
  }
  
  if (contactInfo.areaOrTown?.trim()) {
    parts.push(contactInfo.areaOrTown.trim());
  }
  
  if (contactInfo.countyCityOrPostCode?.trim()) {
    parts.push(contactInfo.countyCityOrPostCode.trim());
  }
  
  if (contactInfo.country?.trim()) {
    parts.push(contactInfo.country.trim());
  }
  
  return parts.join(", ");
};

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
        data.contactInfo.fullAddress = generateFullAddress(data.contactInfo);
      }

      const record = await PersonalDetails.create(data);
      resolve(record);
    } catch (error) {
      console.error("PersonalDetailsHandler [create] Error:", error);
      reject(error);
    }
  });

exports.getByUserId = (userId, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      const mongoose = require("mongoose");
      
      // Convert userId to ObjectId if it's a string
      const userIdQuery = typeof userId === "string" && mongoose.Types.ObjectId.isValid(userId)
        ? new mongoose.Types.ObjectId(userId)
        : userId;

      const query = { 
        userId: userIdQuery,
        "meta.deleted": { $ne: true }
      };
      
      if (tenantId) {
        query.tenantId = tenantId;
      }
      
      const result = await PersonalDetails.findOne(query);
      resolve(result);
    } catch (error) {
      console.error("PersonalDetailsHandler [getByUserId] Error:", error);
      reject(error);
    }
  });

exports.getByEmail = (email, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      // Normalize email for case-insensitive comparison
      const normalizedEmail = email.toLowerCase().trim();
      const query = {
        $or: [
          { "contactInfo.personalEmail": new RegExp(`^${normalizedEmail}$`, "i") },
          { "contactInfo.workEmail": new RegExp(`^${normalizedEmail}$`, "i") },
        ],
        "meta.deleted": { $ne: true },
      };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      const result = await PersonalDetails.findOne(query);
      resolve(result);
    } catch (error) {
      console.error("PersonalDetailsHandler [getByEmail] Error:", error);
      reject(error);
    }
  });

exports.getApplicationById = (applicationId, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      const query = { applicationId: applicationId };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      // Try lowercase first, then uppercase for backward compatibility
      let result = await PersonalDetails.findOne(query);
      
      if (!result) {
        const legacyQuery = { ApplicationId: applicationId };
        if (tenantId) {
          legacyQuery.tenantId = tenantId;
        }
        result = await PersonalDetails.findOne(legacyQuery);
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

exports.getByUserIdAndApplicationId = (userId, applicationId, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      const query = { userId: userId, applicationId: applicationId };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      // Try lowercase first, then uppercase for backward compatibility
      let result = await PersonalDetails.findOne(query);
      
      if (!result) {
        const legacyQuery = { userId: userId, ApplicationId: applicationId };
        if (tenantId) {
          legacyQuery.tenantId = tenantId;
        }
        result = await PersonalDetails.findOne(legacyQuery);
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

exports.updateByApplicationId = (applicationId, updateData, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      if (updateData.contactInfo) {
        updateData.contactInfo.fullAddress = generateFullAddress(updateData.contactInfo);
      }
      
      const query = { applicationId: applicationId };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      // Try lowercase first, then uppercase for backward compatibility
      let record = await PersonalDetails.findOneAndUpdate(
        query,
        updateData,
        {
          new: true,
          runValidators: true,
        }
      );
      
      if (!record) {
        const legacyQuery = { ApplicationId: applicationId };
        if (tenantId) {
          legacyQuery.tenantId = tenantId;
        }
        record = await PersonalDetails.findOneAndUpdate(
          legacyQuery,
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

exports.updateByUserIdAndApplicationId = (
  userId,
  applicationId,
  updateData,
  tenantId
) =>
  new Promise(async (resolve, reject) => {
    try {
      if (updateData.contactInfo) {
        updateData.contactInfo.fullAddress = generateFullAddress(updateData.contactInfo);
      }
      
      const query = { userId: userId, applicationId: applicationId };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      // Try lowercase first, then uppercase for backward compatibility
      let record = await PersonalDetails.findOneAndUpdate(
        query,
        updateData,
        {
          new: true,
          runValidators: true,
        }
      );
      
      if (!record) {
        const legacyQuery = { userId: userId, ApplicationId: applicationId };
        if (tenantId) {
          legacyQuery.tenantId = tenantId;
        }
        record = await PersonalDetails.findOneAndUpdate(
          legacyQuery,
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

exports.deleteByApplicationId = (applicationId, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      const query = { applicationId: applicationId };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      // Try lowercase first, then uppercase for backward compatibility
      let record = await PersonalDetails.findOneAndDelete({
        ...query,
      });
      
      if (!record) {
        const legacyQuery = { ApplicationId: applicationId };
        if (tenantId) {
          legacyQuery.tenantId = tenantId;
        }
        record = await PersonalDetails.findOneAndDelete({
          ...legacyQuery,
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

exports.deleteByUserIdAndApplicationId = (userId, applicationId, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      const query = { userId: userId, applicationId: applicationId };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      // Try lowercase first, then uppercase for backward compatibility
      let record = await PersonalDetails.findOneAndDelete({
        ...query,
      });
      
      if (!record) {
        const legacyQuery = { userId: userId, ApplicationId: applicationId };
        if (tenantId) {
          legacyQuery.tenantId = tenantId;
        }
        record = await PersonalDetails.findOneAndDelete({
          ...legacyQuery,
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

exports.updateApplicationStatus = (applicationId, status, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      const query = { applicationId: applicationId };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      const setPayload = { applicationStatus: status };
      if (status === APPLICATION_STATUS.REJECTED) {
        setPayload["meta.isActive"] = false;
      }

      // Try lowercase first, then uppercase for backward compatibility
      let result = await PersonalDetails.findOneAndUpdate(
        query,
        { $set: setPayload },
        { new: true }
      );

      if (!result) {
        const legacyQuery = { ApplicationId: applicationId };
        if (tenantId) {
          legacyQuery.tenantId = tenantId;
        }
        result = await PersonalDetails.findOneAndUpdate(
          legacyQuery,
          { $set: setPayload },
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

exports.getByUserIdForPortal = (userId, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      const mongoose = require("mongoose");
      
      // Convert userId to ObjectId if it's a string
      const userIdQuery = typeof userId === "string" && mongoose.Types.ObjectId.isValid(userId)
        ? new mongoose.Types.ObjectId(userId)
        : userId;

      const query = {
        userId: userIdQuery,
        "meta.userType": "PORTAL",
        "meta.deleted": { $ne: true },
        "meta.isActive": true,
      };
      
      if (tenantId) {
        query.tenantId = tenantId;
      }
      
      const result = await PersonalDetails.findOne(query).sort({
        updatedAt: -1,
        createdAt: -1,
      });

      console.log("[getByUserIdForPortal] Query result:", result ? "Found" : "Not found");
      
      resolve(result);
    } catch (error) {
      console.error(
        "PersonalDetailsHandler [getByUserIdForPortal] Error:",
        error
      );
      reject(error);
    }
  });

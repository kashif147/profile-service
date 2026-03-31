const ProfessionalDetails = require("../models/professional.details.model");
const personalDetails = require("../models/personal.details.model");

exports.create = (data) =>
  new Promise(async (resolve, reject) => {
    try {
      const record = await ProfessionalDetails.create(data);
      resolve(record);
    } catch (error) {
      console.error("ProfessionalDetailsHandler [create] Error:", error);
      reject(error);
    }
  });

exports.checkApplicationId = (applicationId, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      const query = { applicationId };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      const record = await personalDetails.findOne(query);
      resolve(record);
    } catch (error) {
      console.error(
        "ProfessionalDetailsHandler [checkApplicationId] Error:",
        error
      );
      reject(error);
    }
  });

exports.getByApplicationId = (applicationId, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      const query = { applicationId };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      const record = await ProfessionalDetails.findOne(query);
      resolve(record);
    } catch (error) {
      console.error(
        "ProfessionalDetailsHandler [getByApplicationId] Error:",
        error
      );
      reject(error);
    }
  });

exports.updateByApplicationId = (applicationId, updateData, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      const query = { applicationId };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      const record = await ProfessionalDetails.findOneAndUpdate(
        query,
        updateData,
        {
          new: true,
          runValidators: true,
        }
      );
      if (!record) return reject(new Error("Professional details not found"));
      resolve(record);
    } catch (error) {
      console.error(
        "ProfessionalDetailsHandler [updateByApplicationId] Error:",
        error
      );
      reject(error);
    }
  });

exports.deleteByApplicationId = (applicationId, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      const query = { applicationId };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      const record = await ProfessionalDetails.findOneAndDelete({
        ...query,
      });
      if (!record) return reject(new Error("Professional details not found"));
      resolve(record);
    } catch (error) {
      console.error(
        "ProfessionalDetailsHandler [deleteByApplicationId] Error:",
        error
      );
      reject(error);
    }
  });

exports.checkPersonalDetailsByEmail = (email, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      const query = {
        $or: [
          { "contactInfo.personalEmail": email },
          { "contactInfo.workEmail": email },
        ],
      };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      const record = await personalDetails.findOne(query);
      resolve(record);
    } catch (error) {
      console.error(
        "ProfessionalDetailsHandler [checkPersonalDetailsByEmail] Error:",
        error
      );
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
        "meta.deleted": { $ne: true },
        "meta.isActive": true,
      };
      
      if (tenantId) {
        query.tenantId = tenantId;
      }
      
      const result = await ProfessionalDetails.findOne(query).sort({
        updatedAt: -1,
        createdAt: -1,
      });
      resolve(result);
    } catch (error) {
      console.error("ProfessionalDetailsHandler [getByUserId] Error:", error);
      reject(error);
    }
  });

exports.getByEmail = (email, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      // First find personal details by email to get userId
      const personalDetailsQuery = {
        $or: [
          { "contactInfo.personalEmail": email },
          { "contactInfo.workEmail": email },
        ],
      };
      if (tenantId) {
        personalDetailsQuery.tenantId = tenantId;
      }
      const personalDetailsRecord = await personalDetails.findOne(
        personalDetailsQuery
      );

      if (!personalDetailsRecord) {
        resolve(null);
        return;
      }

      // Then find professional details by userId
      const professionalDetailsQuery = { userId: personalDetailsRecord._id };
      if (tenantId) {
        professionalDetailsQuery.tenantId = tenantId;
      }
      const result = await ProfessionalDetails.findOne(
        professionalDetailsQuery
      );
      resolve(result);
    } catch (error) {
      console.error("ProfessionalDetailsHandler [getByEmail] Error:", error);
      reject(error);
    }
  });

exports.updateByUserId = (userId, updateData, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      const query = { userId };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      const record = await ProfessionalDetails.findOneAndUpdate(
        query,
        updateData,
        {
          new: true,
          runValidators: true,
        }
      );
      if (!record) return reject(new Error("Professional details not found"));
      resolve(record);
    } catch (error) {
      console.error(
        "ProfessionalDetailsHandler [updateByUserId] Error:",
        error
      );
      reject(error);
    }
  });

exports.updateByEmail = (email, updateData, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      // First find personal details by email to get userId
      const personalDetailsQuery = {
        $or: [
          { "contactInfo.personalEmail": email },
          { "contactInfo.workEmail": email },
        ],
      };
      if (tenantId) {
        personalDetailsQuery.tenantId = tenantId;
      }
      const personalDetailsRecord = await personalDetails.findOne(
        personalDetailsQuery
      );

      if (!personalDetailsRecord) {
        return reject(new Error("Personal details not found for this email"));
      }

      // Then update professional details by userId
      const professionalDetailsQuery = { userId: personalDetailsRecord._id };
      if (tenantId) {
        professionalDetailsQuery.tenantId = tenantId;
      }
      const record = await ProfessionalDetails.findOneAndUpdate(
        professionalDetailsQuery,
        updateData,
        {
          new: true,
          runValidators: true,
        }
      );
      if (!record) return reject(new Error("Professional details not found"));
      resolve(record);
    } catch (error) {
      console.error("ProfessionalDetailsHandler [updateByEmail] Error:", error);
      reject(error);
    }
  });

exports.deleteByUserId = (userId, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      const query = { userId };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      const record = await ProfessionalDetails.findOneAndDelete(query);
      if (!record) return reject(new Error("Professional details not found"));
      resolve(record);
    } catch (error) {
      console.error(
        "ProfessionalDetailsHandler [deleteByUserId] Error:",
        error
      );
      reject(error);
    }
  });

exports.deleteByEmail = (email, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      // First find personal details by email to get userId
      const personalDetailsQuery = {
        $or: [
          { "contactInfo.personalEmail": email },
          { "contactInfo.workEmail": email },
        ],
      };
      if (tenantId) {
        personalDetailsQuery.tenantId = tenantId;
      }
      const personalDetailsRecord = await personalDetails.findOne(
        personalDetailsQuery
      );

      if (!personalDetailsRecord) {
        return reject(new Error("Personal details not found for this email"));
      }

      // Then delete professional details by userId
      const professionalDetailsQuery = { userId: personalDetailsRecord._id };
      if (tenantId) {
        professionalDetailsQuery.tenantId = tenantId;
      }
      const record = await ProfessionalDetails.findOneAndDelete(
        professionalDetailsQuery,
        { new: true }
      );
      if (!record) return reject(new Error("Professional details not found"));
      resolve(record);
    } catch (error) {
      console.error("ProfessionalDetailsHandler [deleteByEmail] Error:", error);
      reject(error);
    }
  });

exports.findDeletedByEmail = (email, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      // First find personal details by email to get userId
      const personalDetailsQuery = {
        $or: [
          { "contactInfo.personalEmail": email },
          { "contactInfo.workEmail": email },
        ],
      };
      if (tenantId) {
        personalDetailsQuery.tenantId = tenantId;
      }
      const personalDetailsRecord = await personalDetails.findOne(
        personalDetailsQuery
      );

      if (!personalDetailsRecord) {
        resolve(null);
        return;
      }

      // Then find deleted professional details by userId
      const professionalDetailsQuery = {
        userId: personalDetailsRecord._id,
        "meta.deleted": true,
      };
      if (tenantId) {
        professionalDetailsQuery.tenantId = tenantId;
      }
      const result = await ProfessionalDetails.findOne(
        professionalDetailsQuery
      );
      resolve(result);
    } catch (error) {
      console.error(
        "ProfessionalDetailsHandler [findDeletedByEmail] Error:",
        error
      );
      reject(error);
    }
  });

exports.getApplicationById = (applicationId, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      // Query both uppercase and lowercase field names to handle legacy data
      // Prioritize lowercase since schema uses applicationId
      const query = { applicationId: applicationId };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      let record = await ProfessionalDetails.findOne(query);
      
      // Fallback to uppercase for backward compatibility with legacy data
      if (!record) {
        const legacyQuery = { ApplicationId: applicationId };
        if (tenantId) {
          legacyQuery.tenantId = tenantId;
        }
        record = await ProfessionalDetails.findOne(legacyQuery);
      }
      
      if (!record) return reject(new Error("Professional details not found"));
      resolve(record);
    } catch (error) {
      console.error(
        "ProfessionalDetailsHandler [getApplicationById] Error:",
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
      let record = await ProfessionalDetails.findOne(query);
      
      if (!record) {
        const legacyQuery = { userId: userId, ApplicationId: applicationId };
        if (tenantId) {
          legacyQuery.tenantId = tenantId;
        }
        record = await ProfessionalDetails.findOne(legacyQuery);
      }
      
      resolve(record);
    } catch (error) {
      console.error(
        "ProfessionalDetailsHandler [getByUserIdAndApplicationId] Error:",
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
      const query = { userId: userId, applicationId: applicationId };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      // Try lowercase first, then uppercase for backward compatibility
      let record = await ProfessionalDetails.findOneAndUpdate(
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
        record = await ProfessionalDetails.findOneAndUpdate(
          legacyQuery,
          updateData,
          {
            new: true,
            runValidators: true,
          }
        );
      }
      
      if (!record) return reject(new Error("Professional details not found"));
      resolve(record);
    } catch (error) {
      console.error(
        "ProfessionalDetailsHandler [updateByUserIdAndApplicationId] Error:",
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
      let record = await ProfessionalDetails.findOneAndDelete({
        ...query,
      });
      
      if (!record) {
        const legacyQuery = { userId: userId, ApplicationId: applicationId };
        if (tenantId) {
          legacyQuery.tenantId = tenantId;
        }
        record = await ProfessionalDetails.findOneAndDelete({
          ...legacyQuery,
        });
      }
      
      if (!record) return reject(new Error("Professional details not found"));
      resolve(record);
    } catch (error) {
      console.error(
        "ProfessionalDetailsHandler [deleteByUserIdAndApplicationId] Error:",
        error
      );
      reject(error);
    }
  });
///

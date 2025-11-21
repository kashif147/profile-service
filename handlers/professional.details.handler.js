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

exports.checkApplicationId = (applicationId) =>
  new Promise(async (resolve, reject) => {
    try {
      const record = await personalDetails.findOne({ applicationId });
      resolve(record);
    } catch (error) {
      console.error(
        "ProfessionalDetailsHandler [checkApplicationId] Error:",
        error
      );
      reject(error);
    }
  });

exports.getByApplicationId = (applicationId) =>
  new Promise(async (resolve, reject) => {
    try {
      const record = await ProfessionalDetails.findOne({ applicationId });
      resolve(record);
    } catch (error) {
      console.error(
        "ProfessionalDetailsHandler [getByApplicationId] Error:",
        error
      );
      reject(error);
    }
  });

exports.updateByApplicationId = (applicationId, updateData) =>
  new Promise(async (resolve, reject) => {
    try {
      const record = await ProfessionalDetails.findOneAndUpdate(
        { applicationId },
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

exports.deleteByApplicationId = (applicationId) =>
  new Promise(async (resolve, reject) => {
    try {
      const record = await ProfessionalDetails.findOneAndDelete({
        applicationId,
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

exports.checkPersonalDetailsByEmail = (email) =>
  new Promise(async (resolve, reject) => {
    try {
      const record = await personalDetails.findOne({
        $or: [
          { "contactInfo.personalEmail": email },
          { "contactInfo.workEmail": email },
        ],
      });
      resolve(record);
    } catch (error) {
      console.error(
        "ProfessionalDetailsHandler [checkPersonalDetailsByEmail] Error:",
        error
      );
      reject(error);
    }
  });

exports.getByUserId = (userId) =>
  new Promise(async (resolve, reject) => {
    try {
      const result = await ProfessionalDetails.findOne({ userId });
      resolve(result);
    } catch (error) {
      console.error("ProfessionalDetailsHandler [getByUserId] Error:", error);
      reject(error);
    }
  });

exports.getByEmail = (email) =>
  new Promise(async (resolve, reject) => {
    try {
      // First find personal details by email to get userId
      const personalDetailsRecord = await personalDetails.findOne({
        $or: [
          { "contactInfo.personalEmail": email },
          { "contactInfo.workEmail": email },
        ],
      });

      if (!personalDetailsRecord) {
        resolve(null);
        return;
      }

      // Then find professional details by userId
      const result = await ProfessionalDetails.findOne({
        userId: personalDetailsRecord._id,
      });
      resolve(result);
    } catch (error) {
      console.error("ProfessionalDetailsHandler [getByEmail] Error:", error);
      reject(error);
    }
  });

exports.updateByUserId = (userId, updateData) =>
  new Promise(async (resolve, reject) => {
    try {
      const record = await ProfessionalDetails.findOneAndUpdate(
        { userId },
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

exports.updateByEmail = (email, updateData) =>
  new Promise(async (resolve, reject) => {
    try {
      // First find personal details by email to get userId
      const personalDetailsRecord = await personalDetails.findOne({
        $or: [
          { "contactInfo.personalEmail": email },
          { "contactInfo.workEmail": email },
        ],
      });

      if (!personalDetailsRecord) {
        return reject(new Error("Personal details not found for this email"));
      }

      // Then update professional details by userId
      const record = await ProfessionalDetails.findOneAndUpdate(
        { userId: personalDetailsRecord._id },
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

exports.deleteByUserId = (userId) =>
  new Promise(async (resolve, reject) => {
    try {
      const record = await ProfessionalDetails.findOneAndDelete({ userId });
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

exports.deleteByEmail = (email) =>
  new Promise(async (resolve, reject) => {
    try {
      // First find personal details by email to get userId
      const personalDetailsRecord = await personalDetails.findOne({
        $or: [
          { "contactInfo.personalEmail": email },
          { "contactInfo.workEmail": email },
        ],
      });

      if (!personalDetailsRecord) {
        return reject(new Error("Personal details not found for this email"));
      }

      // Then delete professional details by userId
      const record = await ProfessionalDetails.findOneAndDelete(
        { userId: personalDetailsRecord._id },
        { new: true }
      );
      if (!record) return reject(new Error("Professional details not found"));
      resolve(record);
    } catch (error) {
      console.error("ProfessionalDetailsHandler [deleteByEmail] Error:", error);
      reject(error);
    }
  });

exports.findDeletedByEmail = (email) =>
  new Promise(async (resolve, reject) => {
    try {
      // First find personal details by email to get userId
      const personalDetailsRecord = await personalDetails.findOne({
        $or: [
          { "contactInfo.personalEmail": email },
          { "contactInfo.workEmail": email },
        ],
      });

      if (!personalDetailsRecord) {
        resolve(null);
        return;
      }

      // Then find deleted professional details by userId
      const result = await ProfessionalDetails.findOne({
        userId: personalDetailsRecord._id,
        "meta.deleted": true,
      });
      resolve(result);
    } catch (error) {
      console.error(
        "ProfessionalDetailsHandler [findDeletedByEmail] Error:",
        error
      );
      reject(error);
    }
  });

exports.getApplicationById = (applicationId) =>
  new Promise(async (resolve, reject) => {
    try {
      // Query both uppercase and lowercase field names to handle legacy data
      // Prioritize lowercase since schema uses applicationId
      let record = await ProfessionalDetails.findOne({
        applicationId: applicationId,
      });
      
      // Fallback to uppercase for backward compatibility with legacy data
      if (!record) {
        record = await ProfessionalDetails.findOne({
          ApplicationId: applicationId,
        });
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

exports.getByUserIdAndApplicationId = (userId, applicationId) =>
  new Promise(async (resolve, reject) => {
    try {
      // Try lowercase first, then uppercase for backward compatibility
      let record = await ProfessionalDetails.findOne({
        userId: userId,
        applicationId: applicationId,
      });
      
      if (!record) {
        record = await ProfessionalDetails.findOne({
          userId: userId,
          ApplicationId: applicationId,
        });
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

exports.updateByUserIdAndApplicationId = (userId, applicationId, updateData) =>
  new Promise(async (resolve, reject) => {
    try {
      // Try lowercase first, then uppercase for backward compatibility
      let record = await ProfessionalDetails.findOneAndUpdate(
        { userId: userId, applicationId: applicationId },
        updateData,
        {
          new: true,
          runValidators: true,
        }
      );
      
      if (!record) {
        record = await ProfessionalDetails.findOneAndUpdate(
          { userId: userId, ApplicationId: applicationId },
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

exports.deleteByUserIdAndApplicationId = (userId, applicationId) =>
  new Promise(async (resolve, reject) => {
    try {
      // Try lowercase first, then uppercase for backward compatibility
      let record = await ProfessionalDetails.findOneAndDelete({
        userId: userId,
        applicationId: applicationId,
      });
      
      if (!record) {
        record = await ProfessionalDetails.findOneAndDelete({
          userId: userId,
          ApplicationId: applicationId,
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

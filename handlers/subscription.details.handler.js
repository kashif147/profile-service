const SubscriptionDetails = require("../models/subscription.model");
const personalDetails = require("../models/personal.details.model");

exports.create = (data) =>
  new Promise(async (resolve, reject) => {
    try {
      const record = await SubscriptionDetails.create(data);
      resolve(record);
    } catch (error) {
      console.error("SubscriptionDetailsHandler [create] Error:", error);
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
      const record = await SubscriptionDetails.findOne(query);
      resolve(record);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [getByApplicationId] Error:",
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
      const record = await SubscriptionDetails.findOneAndUpdate(
        query,
        updateData,
        {
          new: true,
          runValidators: true,
        }
      );
      if (!record) return reject(new Error("Subscription details not found"));
      resolve(record);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [updateByApplicationId] Error:",
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
      const record = await SubscriptionDetails.findOneAndDelete({
        ...query,
      });
      if (!record) return reject(new Error("Subscription details not found"));
      resolve(record);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [deleteByApplicationId] Error:",
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
        "meta.deleted": { $ne: true }
      };
      
      if (tenantId) {
        query.tenantId = tenantId;
      }
      
      const result = await SubscriptionDetails.findOne(query);
      resolve(result);
    } catch (error) {
      console.error("SubscriptionDetailsHandler [getByUserId] Error:", error);
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

      // Then find subscription details by userId
      const subscriptionQuery = { userId: personalDetailsRecord._id };
      if (tenantId) {
        subscriptionQuery.tenantId = tenantId;
      }
      const result = await SubscriptionDetails.findOne(subscriptionQuery);
      resolve(result);
    } catch (error) {
      console.error("SubscriptionDetailsHandler [getByEmail] Error:", error);
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
      const record = await SubscriptionDetails.findOneAndUpdate(
        query,
        updateData,
        {
          new: true,
          runValidators: true,
        }
      );
      if (!record) return reject(new Error("Subscription details not found"));
      resolve(record);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [updateByUserId] Error:",
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

      // Then update subscription details by userId
      const subscriptionQuery = { userId: personalDetailsRecord._id };
      if (tenantId) {
        subscriptionQuery.tenantId = tenantId;
      }
      const record = await SubscriptionDetails.findOneAndUpdate(
        subscriptionQuery,
        updateData,
        {
          new: true,
          runValidators: true,
        }
      );
      if (!record) return reject(new Error("Subscription details not found"));
      resolve(record);
    } catch (error) {
      console.error("SubscriptionDetailsHandler [updateByEmail] Error:", error);
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
      const record = await SubscriptionDetails.findOneAndDelete(query);
      if (!record) return reject(new Error("Subscription details not found"));
      resolve(record);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [deleteByUserId] Error:",
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

      // Then delete subscription details by userId
      const subscriptionQuery = { userId: personalDetailsRecord._id };
      if (tenantId) {
        subscriptionQuery.tenantId = tenantId;
      }
      const record = await SubscriptionDetails.findOneAndDelete(
        subscriptionQuery
      );
      if (!record) return reject(new Error("Subscription details not found"));
      resolve(record);
    } catch (error) {
      console.error("SubscriptionDetailsHandler [deleteByEmail] Error:", error);
      reject(error);
    }
  });

exports.findDeletedByUserId = (userId, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      const query = {
        userId,
        "meta.deleted": true,
      };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      const result = await SubscriptionDetails.findOne(query);
      resolve(result);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [findDeletedByUserId] Error:",
        error
      );
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

      // Then find deleted subscription details by userId
      const subscriptionQuery = {
        userId: personalDetailsRecord._id,
        "meta.deleted": true,
      };
      if (tenantId) {
        subscriptionQuery.tenantId = tenantId;
      }
      const result = await SubscriptionDetails.findOne(subscriptionQuery);
      resolve(result);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [findDeletedByEmail] Error:",
        error
      );
      reject(error);
    }
  });

exports.restoreByUserId = (userId, updateData, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      // Remove meta from updateData to avoid conflicts
      const { meta, ...dataWithoutMeta } = updateData;

      const query = { userId, "meta.deleted": true };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      const record = await SubscriptionDetails.findOneAndUpdate(
        query,
        {
          ...dataWithoutMeta,
          "meta.deleted": false,
          "meta.isActive": true,
          "meta.updatedAt": new Date().toLocaleDateString("en-GB"),
        },
        { new: true, runValidators: true }
      );
      if (!record)
        return reject(new Error("Deleted subscription details not found"));
      resolve(record);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [restoreByUserId] Error:",
        error
      );
      reject(error);
    }
  });

exports.restoreByEmail = (email, updateData, tenantId) =>
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

      // Remove meta from updateData to avoid conflicts
      const { meta, ...dataWithoutMeta } = updateData;

      // Then restore subscription details by userId
      const subscriptionQuery = {
        userId: personalDetailsRecord._id,
        "meta.deleted": true,
      };
      if (tenantId) {
        subscriptionQuery.tenantId = tenantId;
      }
      const record = await SubscriptionDetails.findOneAndUpdate(
        subscriptionQuery,
        {
          ...dataWithoutMeta,
          "meta.deleted": false,
          "meta.isActive": true,
          "meta.updatedAt": new Date().toLocaleDateString("en-GB"),
        },
        { new: true, runValidators: true }
      );
      if (!record)
        return reject(new Error("Deleted subscription details not found"));
      resolve(record);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [restoreByEmail] Error:",
        error
      );
      reject(error);
    }
  });

exports.checkifSoftDeleted = (userId, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      const query = {
        userId,
        "meta.deleted": true,
      };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      const result = await SubscriptionDetails.findOne(query);
      resolve(result);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [checkifSoftDeleted] Error:",
        error
      );
      reject(error);
    }
  });

exports.getApplicationById = (applicationId, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      // Try lowercase first, then uppercase for backward compatibility
      const query = { applicationId: applicationId };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      let record = await SubscriptionDetails.findOne(query);
      
      if (!record) {
        const legacyQuery = { ApplicationId: applicationId };
        if (tenantId) {
          legacyQuery.tenantId = tenantId;
        }
        record = await SubscriptionDetails.findOne(legacyQuery);
      }
      
      resolve(record);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [getApplicationById] Error:",
        error
      );
      reject(error);
    }
  });

exports.getByUserIdAndApplicationId = (userId, applicationId, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      // Try lowercase first, then uppercase for backward compatibility
      const query = { userId: userId, applicationId: applicationId };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      let record = await SubscriptionDetails.findOne(query);
      
      if (!record) {
        const legacyQuery = { userId: userId, ApplicationId: applicationId };
        if (tenantId) {
          legacyQuery.tenantId = tenantId;
        }
        record = await SubscriptionDetails.findOne(legacyQuery);
      }
      
      resolve(record);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [getByUserIdAndApplicationId] Error:",
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
      // Try lowercase first, then uppercase for backward compatibility
      const query = { userId: userId, applicationId: applicationId };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      let record = await SubscriptionDetails.findOneAndUpdate(
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
        record = await SubscriptionDetails.findOneAndUpdate(
          legacyQuery,
          updateData,
          {
            new: true,
            runValidators: true,
          }
        );
      }
      
      if (!record) return reject(new Error("Subscription details not found"));
      resolve(record);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [updateByUserIdAndApplicationId] Error:",
        error
      );
      reject(error);
    }
  });

exports.deleteByUserIdAndApplicationId = (userId, applicationId, tenantId) =>
  new Promise(async (resolve, reject) => {
    try {
      // Try lowercase first, then uppercase for backward compatibility
      const query = { userId: userId, applicationId: applicationId };
      if (tenantId) {
        query.tenantId = tenantId;
      }
      let record = await SubscriptionDetails.findOneAndDelete({
        ...query,
      });
      
      if (!record) {
        const legacyQuery = { userId: userId, ApplicationId: applicationId };
        if (tenantId) {
          legacyQuery.tenantId = tenantId;
        }
        record = await SubscriptionDetails.findOneAndDelete({
          ...legacyQuery,
        });
      }
      
      if (!record) return reject(new Error("Subscription details not found"));
      resolve(record);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [deleteByUserIdAndApplicationId] Error:",
        error
      );
      reject(error);
    }
  });

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

exports.getByApplicationId = (ApplicationId) =>
  new Promise(async (resolve, reject) => {
    try {
      const record = await SubscriptionDetails.findOne({ ApplicationId });
      resolve(record);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [getByApplicationId] Error:",
        error
      );
      reject(error);
    }
  });

exports.updateByApplicationId = (ApplicationId, updateData) =>
  new Promise(async (resolve, reject) => {
    try {
      const record = await SubscriptionDetails.findOneAndUpdate(
        { ApplicationId },
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

exports.deleteByApplicationId = (ApplicationId) =>
  new Promise(async (resolve, reject) => {
    try {
      const record = await SubscriptionDetails.findOneAndDelete({
        ApplicationId,
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

exports.getByUserId = (userId) =>
  new Promise(async (resolve, reject) => {
    try {
      const result = await SubscriptionDetails.findOne({ userId });
      resolve(result);
    } catch (error) {
      console.error("SubscriptionDetailsHandler [getByUserId] Error:", error);
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

      // Then find subscription details by userId
      const result = await SubscriptionDetails.findOne({
        userId: personalDetailsRecord._id,
      });
      resolve(result);
    } catch (error) {
      console.error("SubscriptionDetailsHandler [getByEmail] Error:", error);
      reject(error);
    }
  });

exports.updateByUserId = (userId, updateData) =>
  new Promise(async (resolve, reject) => {
    try {
      const record = await SubscriptionDetails.findOneAndUpdate(
        { userId },
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

      // Then update subscription details by userId
      const record = await SubscriptionDetails.findOneAndUpdate(
        { userId: personalDetailsRecord._id },
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

exports.deleteByUserId = (userId) =>
  new Promise(async (resolve, reject) => {
    try {
      const record = await SubscriptionDetails.findOneAndDelete({ userId });
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

      // Then delete subscription details by userId
      const record = await SubscriptionDetails.findOneAndDelete({
        userId: personalDetailsRecord._id,
      });
      if (!record) return reject(new Error("Subscription details not found"));
      resolve(record);
    } catch (error) {
      console.error("SubscriptionDetailsHandler [deleteByEmail] Error:", error);
      reject(error);
    }
  });

exports.findDeletedByUserId = (userId) =>
  new Promise(async (resolve, reject) => {
    try {
      const result = await SubscriptionDetails.findOne({
        userId,
        "meta.deleted": true,
      });
      resolve(result);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [findDeletedByUserId] Error:",
        error
      );
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

      // Then find deleted subscription details by userId
      const result = await SubscriptionDetails.findOne({
        userId: personalDetailsRecord._id,
        "meta.deleted": true,
      });
      resolve(result);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [findDeletedByEmail] Error:",
        error
      );
      reject(error);
    }
  });

exports.restoreByUserId = (userId, updateData) =>
  new Promise(async (resolve, reject) => {
    try {
      // Remove meta from updateData to avoid conflicts
      const { meta, ...dataWithoutMeta } = updateData;

      const record = await SubscriptionDetails.findOneAndUpdate(
        { userId, "meta.deleted": true },
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

exports.restoreByEmail = (email, updateData) =>
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

      // Remove meta from updateData to avoid conflicts
      const { meta, ...dataWithoutMeta } = updateData;

      // Then restore subscription details by userId
      const record = await SubscriptionDetails.findOneAndUpdate(
        { userId: personalDetailsRecord._id, "meta.deleted": true },
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

exports.checkifSoftDeleted = (userId) =>
  new Promise(async (resolve, reject) => {
    try {
      const result = await SubscriptionDetails.findOne({
        userId,
        "meta.deleted": true,
      });
      resolve(result);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [checkifSoftDeleted] Error:",
        error
      );
      reject(error);
    }
  });

exports.getApplicationById = (applicationId) =>
  new Promise(async (resolve, reject) => {
    try {
      const record = await SubscriptionDetails.findOne({
        ApplicationId: applicationId,
      });
      resolve(record);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [getApplicationById] Error:",
        error
      );
      reject(error);
    }
  });

exports.getByUserIdAndApplicationId = (userId, applicationId) =>
  new Promise(async (resolve, reject) => {
    try {
      const record = await SubscriptionDetails.findOne({
        userId: userId,
        ApplicationId: applicationId,
      });
      resolve(record);
    } catch (error) {
      console.error(
        "SubscriptionDetailsHandler [getByUserIdAndApplicationId] Error:",
        error
      );
      reject(error);
    }
  });

exports.updateByUserIdAndApplicationId = (userId, applicationId, updateData) =>
  new Promise(async (resolve, reject) => {
    try {
      const record = await SubscriptionDetails.findOneAndUpdate(
        { userId: userId, ApplicationId: applicationId },
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
        "SubscriptionDetailsHandler [updateByUserIdAndApplicationId] Error:",
        error
      );
      reject(error);
    }
  });

exports.deleteByUserIdAndApplicationId = (userId, applicationId) =>
  new Promise(async (resolve, reject) => {
    try {
      const record = await SubscriptionDetails.findOneAndDelete({
        userId: userId,
        ApplicationId: applicationId,
      });
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

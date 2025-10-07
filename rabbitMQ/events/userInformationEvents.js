// const { publishEvent } = require("message-bus");

// // Personal Details Events
// const emitPersonalDetailsCreated = async (data) => {
//   try {
//     await publishEvent("personalDetails.created", {
//       personalDetailsId: data._id,
//       userId: data.userId,
//       data: data,
//       timestamp: new Date().toISOString()
//     });
//     console.log("✅ Personal Details Created Event emitted:", data._id);
//   } catch (error) {
//     console.error("❌ Error emitting Personal Details Created Event:", error.message);
//   }
// };

// const emitPersonalDetailsUpdated = async (data) => {
//   try {
//     await publishEvent("personalDetails.updated", {
//       personalDetailsId: data._id,
//       userId: data.userId,
//       data: data,
//       timestamp: new Date().toISOString()
//     });
//     console.log("✅ Personal Details Updated Event emitted:", data._id);
//   } catch (error) {
//     console.error("❌ Error emitting Personal Details Updated Event:", error.message);
//   }
// };

// // Professional Details Events
// const emitProfessionalDetailsCreated = async (data) => {
//   try {
//     await publishEvent("professionalDetails.created", {
//       professionalDetailsId: data._id,
//       profileId: data.profileId,
//       data: data,
//       timestamp: new Date().toISOString()
//     });
//     console.log("✅ Professional Details Created Event emitted:", data._id);
//   } catch (error) {
//     console.error("❌ Error emitting Professional Details Created Event:", error.message);
//   }
// };

// const emitProfessionalDetailsUpdated = async (data) => {
//   try {
//     await publishEvent("professionalDetails.updated", {
//       professionalDetailsId: data._id,
//       profileId: data.profileId,
//       data: data,
//       timestamp: new Date().toISOString()
//     });
//     console.log("✅ Professional Details Updated Event emitted:", data._id);
//   } catch (error) {
//     console.error("❌ Error emitting Professional Details Updated Event:", error.message);
//   }
// };

// // Subscription Details Events
// const emitSubscriptionDetailsCreated = async (data) => {
//   try {
//     await publishEvent("subscriptionDetails.created", {
//       subscriptionId: data._id,
//       profileId: data.profileId,
//       data: data,
//       timestamp: new Date().toISOString()
//     });
//     console.log("✅ Subscription Details Created Event emitted:", data._id);
//   } catch (error) {
//     console.error("❌ Error emitting Subscription Details Created Event:", error.message);
//   }
// };

// const emitSubscriptionDetailsUpdated = async (data) => {
//   try {
//     await publishEvent("subscriptionDetails.updated", {
//       subscriptionId: data._id,
//       profileId: data.profileId,
//       data: data,
//       timestamp: new Date().toISOString()
//     });
//     console.log("✅ Subscription Details Updated Event emitted:", data._id);
//   } catch (error) {
//     console.error("❌ Error emitting Subscription Details Updated Event:", error.message);
//   }
// };

// // User Information Flow Events
// const emitUserInformationSubmitted = async (data) => {
//   try {
//     await publishEvent("userInformation.submitted", {
//       personalDetailsId: data.personalDetails?._id,
//       professionalDetailsId: data.professionalDetails?._id,
//       subscriptionId: data.subscriptionDetails?._id,
//       data: data,
//       timestamp: new Date().toISOString()
//     });
//     console.log("✅ User Information Submitted Event emitted");
//   } catch (error) {
//     console.error("❌ Error emitting User Information Submitted Event:", error.message);
//   }
// };

// const emitUserInformationUpdated = async (data) => {
//   try {
//     await publishEvent("userInformation.updated", {
//       personalDetailsId: data.personalDetails?._id,
//       professionalDetailsId: data.professionalDetails?._id,
//       subscriptionId: data.subscriptionDetails?._id,
//       data: data,
//       timestamp: new Date().toISOString()
//     });
//     console.log("✅ User Information Updated Event emitted");
//   } catch (error) {
//     console.error("❌ Error emitting User Information Updated Event:", error.message);
//   }
// };

// module.exports = {
//   emitPersonalDetailsCreated,
//   emitPersonalDetailsUpdated,
//   emitProfessionalDetailsCreated,
//   emitProfessionalDetailsUpdated,
//   emitSubscriptionDetailsCreated,
//   emitSubscriptionDetailsUpdated,
//   emitUserInformationSubmitted,
//   emitUserInformationUpdated
// };

// const { subscribeToEvent } = require("message-bus");
// const LookupType = require("../models/LookupType");

// // Listen for lookup type created event
// subscribeToEvent("lookuptype.created", async (data) => {
//   try {
//     // Create the same lookup type in Profile Service
//     await LookupType.create({
//       _id: data.lookupTypeId, // Use the same ID as Config Service
//       code: data.code,
//       lookuptype: data.lookuptype,
//       displayname: data.displayname,
//       isdeleted: data.isdeleted || false,
//       isactive: data.isactive || true,
//       userid: data.userid,
//     });
//     console.log("✅ [Profile] LookupType Created Event processed:", data);
//   } catch (error) {
//     console.error("❌ [Profile] Error processing LookupType Created Event:", error.message);
//   }
// });

// // Listen for lookup type updated event
// subscribeToEvent("lookuptype.updated", async (data) => {
//   try {
//     const { lookupTypeId, newValues } = data;
//     await LookupType.findByIdAndUpdate(
//       lookupTypeId,
//       {
//         code: newValues.code,
//         lookuptype: newValues.lookuptype,
//         displayname: newValues.displayname,
//         isdeleted: newValues.isdeleted,
//         isactive: newValues.isactive,
//       },
//       { new: true }
//     );
//     console.log("✅ [Profile] LookupType Updated Event processed:", data);
//   } catch (error) {
//     console.error("❌ [Profile] Error processing LookupType Updated Event:", error.message);
//   }
// });

// // Listen for lookup type deleted event
// subscribeToEvent("lookuptype.deleted", async (data) => {
//   try {
//     await LookupType.findByIdAndDelete(data.lookupTypeId);
//     console.log("✅ [Profile] LookupType Deleted Event processed:", data);
//   } catch (error) {
//     console.error("❌ [Profile] Error processing LookupType Deleted Event:", error.message);
//   }
// });

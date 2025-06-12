// const { subscribeToEvent } = require("message-bus");
// const Lookup = require("../models/Lookup");

// // Listen for lookup created event
// subscribeToEvent("lookup.created", async (data) => {
//   try {
//     // Create the same lookup in Profile Service
//     await Lookup.create({
//       _id: data.lookupId, // Use the same ID as Config Service
//       code: data.code,
//       lookupname: data.lookupname,
//       DisplayName: data.DisplayName,
//       Parentlookupid: data.Parentlookupid,
//       lookuptypeId: data.lookuptypeId,
//       isdeleted: data.isdeleted || false,
//       isactive: data.isactive || true,
//       userid: data.userid,
//     });
//     console.log("✅ [Profile] Lookup Created Event processed:", data);
//   } catch (error) {
//     console.error("❌ [Profile] Error processing Lookup Created Event:", error.message);
//   }
// });

// // Listen for lookup updated event
// subscribeToEvent("lookup.updated", async (data) => {
//   try {
//     const { lookupId, newValues } = data;
//     await Lookup.findByIdAndUpdate(
//       lookupId,
//       {
//         code: newValues.code,
//         lookupname: newValues.lookupname,
//         DisplayName: newValues.DisplayName,
//         Parentlookupid: newValues.Parentlookupid,
//         lookuptypeId: newValues.lookuptypeId,
//         isdeleted: newValues.isdeleted,
//         isactive: newValues.isactive,
//       },
//       { new: true }
//     );
//     console.log("✅ [Profile] Lookup Updated Event processed:", data);
//   } catch (error) {
//     console.error("❌ [Profile] Error processing Lookup Updated Event:", error.message);
//   }
// });

// // Listen for lookup deleted event
// subscribeToEvent("lookup.deleted", async (data) => {
//   try {
//     await Lookup.findByIdAndDelete(data.lookupId);
//     console.log("✅ [Profile] Lookup Deleted Event processed:", data);
//   } catch (error) {
//     console.error("❌ [Profile] Error processing Lookup Deleted Event:", error.message);
//   }
// });

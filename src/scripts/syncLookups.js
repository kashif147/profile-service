const mongoose = require("mongoose");
const { Types } = require("mongoose");
const axios = require("axios");
const Lookup = require("../models/Lookup");
const LookupType = require("../models/LookupType");
require("dotenv").config();

const CONFIG_SERVICE_URL = "https://projectshellapi-c0hqhbdwaaahbcab.northeurope-01.azurewebsites.net";

const ADMIN_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJVc2VySW5mbyI6eyJ1c2VybmFtZSI6IndhbHQxIiwicm9sZXMiOls1MTUwLG51bGwsbnVsbF19LCJpYXQiOjE3NDg5NjQ5ODEsImV4cCI6MTc0ODk2NTg4MX0.rZ6Kjece5VAlGzjxTvWom_LXVlTlP7VAQIMjDIZiKzY";

const api = axios.create({
  baseURL: CONFIG_SERVICE_URL,
  headers: {
    Authorization: `Bearer ${ADMIN_TOKEN}`,
    "Content-Type": "application/json",
  },
});

function toObjectIdIfValid(val) {
  if (!val) return val;
  if (val instanceof Types.ObjectId) return val;
  if (typeof val === "object" && val._id) return toObjectIdIfValid(val._id);
  if (typeof val === "string" && /^[a-fA-F0-9]{24}$/.test(val)) return new Types.ObjectId(val);
  return val;
}

async function syncLookupTypes() {
  try {
    console.log("Syncing Lookup Types...");

    const response = await api.get("/lookuptype");
    const lookupTypes = response.data;

    await LookupType.deleteMany({});
    console.log("Cleared existing lookup types");

    let successCount = 0;
    let skipCount = 0;

    for (const lookupType of lookupTypes) {
      try {
        let doc = { ...lookupType };
        doc._id = toObjectIdIfValid(doc._id);
        doc.userid = toObjectIdIfValid(doc.userid);

        await LookupType.collection.insertOne(doc);
        console.log(`Created lookup type: ${doc._id}`);
        successCount++;
      } catch (lookupTypeError) {
        console.error(`Error creating lookup type ${lookupType._id}:`, lookupTypeError.message);
        skipCount++;
      }
    }

    console.log(`Lookup Types Sync Summary:`);
    console.log(`   - Total lookup types processed: ${lookupTypes.length}`);
    console.log(`   - Successfully synced: ${successCount}`);
    console.log(`   - Skipped/Failed: ${skipCount}`);
  } catch (error) {
    console.error("Error syncing lookup types:", error.message);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
    }
    throw error;
  }
}

async function syncLookups() {
  try {
    console.log("Syncing Lookups...");

    const response = await api.get("/lookup");
    const lookups = response.data;

    await Lookup.deleteMany({});
    console.log("Cleared existing lookups");

    let successCount = 0;
    let skipCount = 0;

    for (const lookup of lookups) {
      try {
        let doc = { ...lookup };
        doc._id = toObjectIdIfValid(doc._id);
        doc.lookuptypeId = toObjectIdIfValid(doc.lookuptypeId);
        doc.Parentlookupid = toObjectIdIfValid(doc.Parentlookupid);
        doc.userid = toObjectIdIfValid(doc.userid);

        await Lookup.collection.insertOne(doc);
        console.log(`Created lookup: ${doc._id}`);
        successCount++;
      } catch (lookupError) {
        console.error(`Error creating lookup ${lookup._id}:`, lookupError.message);
        skipCount++;
      }
    }
    console.log(`Sync Summary:`);
    console.log(`   - Total lookups processed: ${lookups.length}`);
    console.log(`   - Successfully synced: ${successCount}`);
    console.log(`   - Skipped/Failed: ${skipCount}`);
  } catch (error) {
    console.error("Error syncing lookups:", error.message);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
    }
    throw error;
  }
}

async function syncAll() {
  try {
    await mongoose.connect(
      "mongodb+srv://kashif:kashif@clusterprojectshell.tptnh8w.mongodb.net/Profile-Service?retryWrites=true&w=majority"
    );
    console.log("Connected to MongoDB");

    await syncLookupTypes();
    await syncLookups();

    console.log("All sync operations completed successfully");
  } catch (error) {
    console.error("Sync failed:", error.message);
  } finally {
    await mongoose.connection.close();
    console.log("MongoDB connection closed");
  }
}

syncAll();

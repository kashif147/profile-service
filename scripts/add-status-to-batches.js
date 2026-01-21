/**
 * Migration Script: Add status field to existing batches
 * Usage: node scripts/add-status-to-batches.js
 */

const mongoose = require("mongoose");
require("dotenv").config();

const Batch = require("../models/batch.model.js");

const MONGODB_URI = "mongodb+srv://kashif147:Test12**@clusterprojectshell.tptnh8w.mongodb.net/Profile-Service?retryWrites=true&w=majority&appName=ClusterProjectShell"
if (!MONGODB_URI) {
  console.error("Error: MONGODB_URI or DATABASE_URL not set");
  process.exit(1);
}

async function addStatusToBatches() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI);
    console.log("Connected successfully");

    const totalCount = await Batch.countDocuments({});
    console.log(`Found ${totalCount} total batch(es)`);

    if (totalCount === 0) {
      console.log("No batches found in database");
      await mongoose.connection.close();
      return;
    }

    const result = await Batch.updateMany(
      {},
      { $set: { status: "pending" } }
    );

    console.log(`Updated ${result.modifiedCount} batch(es) with status: "pending"`);
    
    await mongoose.connection.close();
    console.log("Migration completed successfully");
  } catch (error) {
    console.error("Migration error:", error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

addStatusToBatches();

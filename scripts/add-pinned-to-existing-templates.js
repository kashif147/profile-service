/**
 * Migration script: add pinned field to all existing Template documents.
 * Sets pinned to false where the field is missing.
 *
 * Run from profile-service root:
 *   node scripts/add-pinned-to-existing-templates.js
 */

const mongoose = require("mongoose");
const Template = require("../models/template.model");
require("dotenv").config();

const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.DATABASE_URL ||
  "mongodb+srv://kashif147:Test12**@clusterprojectshell.tptnh8w.mongodb.net/Profile-Service?retryWrites=true&w=majority&appName=ClusterProjectShell";

async function addPinnedToExisting() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI);
    console.log("Connected.\n");

    const filter = {
      $or: [
        { pinned: { $exists: false } },
        { pinned: null },
      ],
    };

    const countBefore = await Template.countDocuments(filter);
    console.log(`Found ${countBefore} template(s) missing pinned.\n`);

    if (countBefore === 0) {
      console.log("Nothing to update. Exiting.");
      process.exit(0);
      return;
    }

    const result = await Template.updateMany(filter, {
      $set: { pinned: false },
    });

    console.log("Update result:", result);
    console.log(`Updated ${result.modifiedCount} template(s) with pinned: false.\n`);
    console.log("Done.");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log("MongoDB connection closed.");
    process.exit(0);
  }
}

addPinnedToExisting();

/**
 * Migration script: add templateType to all existing Template documents.
 * Sets templateType to "application" where the field is missing.
 *
 * Run from profile-service root:
 *   node scripts/add-template-type-to-existing-templates.js
 */

const mongoose = require("mongoose");
const Template = require("../models/template.model");
require("dotenv").config();

const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.DATABASE_URL ||
  "mongodb+srv://kashif147:Test12**@clusterprojectshell.tptnh8w.mongodb.net/Profile-Service?retryWrites=true&w=majority&appName=ClusterProjectShell";

const DEFAULT_TEMPLATE_TYPE = "application";

async function addTemplateTypeToExisting() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI);
    console.log("Connected.\n");

    const filter = {
      $or: [
        { templateType: { $exists: false } },
        { templateType: null },
        { templateType: "" },
      ],
    };

    const countBefore = await Template.countDocuments(filter);
    console.log(
      `Found ${countBefore} template(s) missing or empty templateType.\n`
    );

    if (countBefore === 0) {
      console.log("Nothing to update. Exiting.");
      process.exit(0);
      return;
    }

    const result = await Template.updateMany(filter, {
      $set: { templateType: DEFAULT_TEMPLATE_TYPE },
    });

    console.log("Update result:", result);
    console.log(`Updated ${result.modifiedCount} template(s) with templateType: "${DEFAULT_TEMPLATE_TYPE}".\n`);
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

addTemplateTypeToExisting();

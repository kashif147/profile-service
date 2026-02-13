/**
 * Script: Delete all templates, then create the system default template.
 *
 * - Deletes all templates (user + system).
 * - Creates one system default template with:
 *   - All allowed columns (camelCase, from APPLICATION_RESPONSE_COLUMNS).
 *   - Filter: applicationStatus equal_to ["submitted"].
 *
 * Run from profile-service: node scripts/reset-templates-and-seed-system-default.js
 */

const mongoose = require("mongoose");
const Template = require("../models/template.model");
const {
  APPLICATION_STATUS,
  APPLICATION_RESPONSE_COLUMNS,
  FILTER_OPERATOR,
} = require("../constants/enums");
require("dotenv").config();

const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.DATABASE_URL ||
  "mongodb+srv://kashif147:Test12**@clusterprojectshell.tptnh8w.mongodb.net/Profile-Service?retryWrites=true&w=majority&appName=ClusterProjectShell";

const SYSTEM_DEFAULT_TEMPLATE = {
  name: "System default",
  templateType: "application",
  userId: null,
  filters: {
    applicationStatus: {
      operator: FILTER_OPERATOR.EQUAL_TO,
      values: [APPLICATION_STATUS.SUBMITTED],
    },
  },
  columns: [...APPLICATION_RESPONSE_COLUMNS],
  isDefault: false,
  pinned: false,
  systemDefault: true,
  meta: {
    deleted: false,
    deletedAt: null,
  },
};

async function main() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI);
    console.log("Connected.\n");

    console.log("Deleting all templates...");
    const deleteResult = await Template.deleteMany({});
    console.log("Deleted count:", deleteResult.deletedCount, "\n");

    console.log("Creating system default template...");
    const template = new Template(SYSTEM_DEFAULT_TEMPLATE);
    const saved = await template.save();

    console.log("System default template created.");
    console.log("  _id:", saved._id);
    console.log("  filters.applicationStatus:", saved.filters.applicationStatus);
    console.log("  columns count:", saved.columns.length);
    console.log("  systemDefault:", saved.systemDefault);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log("\nConnection closed.");
    process.exit(0);
  }
}

main();

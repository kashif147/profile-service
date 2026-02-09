/**
 * Script to create/update the System Default Template
 * 
 * This template is used when users call PUT /api/applications/filter
 * without providing a templateId
 * 
 * Run: node scripts/seed-system-default-template.js
 */

const mongoose = require("mongoose");
const Template = require("../models/template.model");
const { APPLICATION_STATUS } = require("../constants/enums");
require("dotenv").config();

// Database connection string - reads from environment variable or .env file
const MONGODB_URI = process.env.MONGODB_URI || process.env.DATABASE_URL || "mongodb+srv://kashif147:Test12**@clusterprojectshell.tptnh8w.mongodb.net/Profile-Service?retryWrites=true&w=majority&appName=ClusterProjectShell";

// System Default Template Configuration
const SYSTEM_DEFAULT_TEMPLATE = {
  templateType: "application", // Type of template: "application" or any future type
  userId: null, // System template doesn't belong to any user
  filters: {
    type: APPLICATION_STATUS.SUBMITTED, // Show only submitted applications by default
  },
  columns: [], // Empty array = return all fields
  isDefault: false, // Not a user's default
  systemDefault: true, // THIS IS THE SYSTEM DEFAULT
  meta: {
    deleted: false,
    deletedAt: null,
  },
};

async function seedSystemDefaultTemplate() {
  try {
    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    console.log("🔍 Checking for existing system default template...");
    
    // Check if system default template already exists
    const existingTemplate = await Template.findOne({
      systemDefault: true,
      "meta.deleted": false,
    });

    if (existingTemplate) {
      console.log("⚠️  System default template already exists:");
      console.log(JSON.stringify(existingTemplate, null, 2));
      console.log("\n❓ Do you want to update it? (This script will exit. Update manually in DB if needed)");
      process.exit(0);
    }

    console.log("📝 Creating system default template...");
    
    const template = new Template(SYSTEM_DEFAULT_TEMPLATE);
    const savedTemplate = await template.save();

    console.log("\n✅ System default template created successfully!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Template ID:", savedTemplate._id);
    console.log("Filters:", JSON.stringify(savedTemplate.filters, null, 2));
    console.log("Columns:", savedTemplate.columns);
    console.log("System Default:", savedTemplate.systemDefault);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("🎉 Done! The system default template is ready to use.");
    console.log("\n📝 To edit this template, update it directly in the database:");
    console.log(`   Template ID: ${savedTemplate._id}`);
    console.log("\n💡 Users calling PUT /api/applications/filter without templateId will use this template.\n");

  } catch (error) {
    console.error("❌ Error seeding system default template:", error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log("🔌 MongoDB connection closed.");
    process.exit(0);
  }
}

// Run the script
seedSystemDefaultTemplate();

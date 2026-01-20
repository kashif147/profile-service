#!/usr/bin/env node

/**
 * Script to seed users from user-service to profile-service
 * 
 * This script:
 * 1. Connects to both user-service and profile-service databases
 * 2. Fetches all users from user-service
 * 3. Maps only the fields required in profile-service user model
 * 4. Inserts/updates users in profile-service (handles duplicates)
 * 
 * Usage: 
 *   NODE_ENV=staging node scripts/seed-users-from-user-service.js
 *   or
 *   node scripts/seed-users-from-user-service.js (uses default .env)
 */

require("dotenv").config();

const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");

// Get MongoDB URI from environment or construct from components
function getMongoUri(serviceName = "user-service", baseUri = null) {
  // If baseUri provided, replace database name
  if (baseUri) {
    const dbName =
      process.env[`${serviceName.toUpperCase().replace("-", "_")}_MONGO_DB`] ||
      `${serviceName}-staging`;
    // Replace database name in URI
    return baseUri.replace(/\/[^\/\?]+(\?|$)/, `/${dbName}$1`);
  }

  // Try service-specific URI
  const serviceUri =
    process.env[`${serviceName.toUpperCase().replace("-", "_")}_MONGO_URI`];
  if (serviceUri) {
    return serviceUri;
  }

  // Try direct MONGO_URI and modify database name
  if (process.env.MONGO_URI) {
    const dbName =
      process.env[`${serviceName.toUpperCase().replace("-", "_")}_MONGO_DB`] ||
      `${serviceName}-staging`;
    return process.env.MONGO_URI.replace(/\/[^\/\?]+(\?|$)/, `/${dbName}$1`);
  }

  // Construct from components
  const user = process.env.MONGO_USER;
  const pass = process.env.MONGO_PASS;
  const cluster =
    process.env.MONGO_CLUSTER || "clusterprojectshell.tptnh8w.mongodb.net";
  const dbName =
    process.env[`${serviceName.toUpperCase().replace("-", "_")}_MONGO_DB`] ||
    process.env.MONGO_DB ||
    `${serviceName}-staging`;

  if (user && pass) {
    return `mongodb+srv://${user}:${pass}@${cluster}/${dbName}?retryWrites=true&w=majority&appName=ClusterProjectShell`;
  }

  throw new Error(
    `Cannot construct MongoDB URI for ${serviceName}. Please set MONGO_URI or MONGO_USER/MONGO_PASS`
  );
}

// Connect to multiple databases
async function connectToDatabases() {
  const connections = {};

  try {
    // User Service Database
    const userServiceUri = getMongoUri("user-service");
    console.log("🔗 Connecting to User Service database...");
    console.log(`   URI: ${userServiceUri.replace(/:[^:@]+@/, ":****@")}`); // Hide password
    connections.userService = await mongoose.createConnection(userServiceUri, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    });
    console.log(
      `✅ Connected to User Service: ${connections.userService.name}`
    );

    // Profile Service Database
    // Try to get from profile-service .env if exists
    const profileServiceEnvPath = path.join(
      __dirname,
      "..",
      ".env"
    );
    let profileServiceUri = process.env.PROFILE_SERVICE_MONGO_URI;

    if (!profileServiceUri && fs.existsSync(profileServiceEnvPath)) {
      const profileEnv = require("dotenv").config({
        path: profileServiceEnvPath,
      }).parsed;
      profileServiceUri =
        profileEnv?.MONGO_URI || getMongoUri("profile-service", userServiceUri);
    } else {
      profileServiceUri = getMongoUri("profile-service", userServiceUri);
    }

    console.log("🔗 Connecting to Profile Service database...");
    console.log(`   URI: ${profileServiceUri.replace(/:[^:@]+@/, ":****@")}`); // Hide password
    connections.profileService = await mongoose.createConnection(
      profileServiceUri,
      {
        serverSelectionTimeoutMS: 30000,
        connectTimeoutMS: 30000,
        socketTimeoutMS: 30000,
      }
    );
    console.log(
      `✅ Connected to Profile Service: ${connections.profileService.name}`
    );

    return connections;
  } catch (error) {
    console.error("❌ Database connection error:", error.message);
    // Close any opened connections
    for (const conn of Object.values(connections)) {
      if (conn && conn.readyState === 1) {
        await conn.close();
      }
    }
    throw error;
  }
}

// Load models for each database connection
function loadModels(connections) {
  // User Service User Model
  const UserServiceUserSchema = new mongoose.Schema(
    {
      tenantId: { type: String, required: true, index: true },
      userEmail: { type: String, default: null },
      userFirstName: { type: String, default: null },
      userLastName: { type: String, default: null },
      userFullName: { type: String, default: null },
      userMobilePhone: { type: String, default: null },
      userMicrosoftId: { type: String, default: null },
      userType: { type: String, enum: ["PORTAL", "CRM"], default: "PORTAL" },
      isActive: { type: Boolean, default: true },
    },
    { collection: "users", strict: false }
  );

  const UserServiceUser =
    connections.userService.models.User ||
    connections.userService.model("User", UserServiceUserSchema);

  // Profile Service User Model
  const ProfileServiceUserSchema = new mongoose.Schema(
    {
      tenantId: { type: String, required: true, index: true },
      userId: { type: String, index: true },
      userEmail: { type: String, default: null },
      userFirstName: { type: String, default: null },
      userLastName: { type: String, default: null },
      userFullName: { type: String, default: null },
      userMobilePhone: { type: String, default: null },
      userMicrosoftId: { type: String, default: null },
      userType: { type: String, enum: ["PORTAL", "CRM"], default: "PORTAL" },
      isActive: { type: Boolean, default: true },
    },
    { collection: "users", strict: false }
  );

  const ProfileServiceUser =
    connections.profileService.models.User ||
    connections.profileService.model("User", ProfileServiceUserSchema);

  return { UserServiceUser, ProfileServiceUser };
}

// Map user from user-service to profile-service format
function mapUserToProfileService(user) {
  return {
    tenantId: user.tenantId,
    userId: user._id.toString(), // Convert ObjectId to String
    userEmail: user.userEmail || null,
    userFirstName: user.userFirstName || null,
    userLastName: user.userLastName || null,
    userFullName: user.userFullName || null,
    userMobilePhone: user.userMobilePhone || null,
    userMicrosoftId: user.userMicrosoftId || null,
    userType: user.userType || "PORTAL",
    isActive: user.isActive !== undefined ? user.isActive : true,
  };
}

// Main function
async function seedUsers() {
  let connections = null;

  try {
    // Connect to databases
    connections = await connectToDatabases();
    const { UserServiceUser, ProfileServiceUser } = loadModels(connections);

    // Fetch all users from user-service
    console.log("\n📊 Fetching users from User Service...");
    const userServiceUsers = await UserServiceUser.find({}).lean();
    console.log(`✅ Found ${userServiceUsers.length} users in User Service`);

    if (userServiceUsers.length === 0) {
      console.log("⚠️  No users found in User Service. Exiting.");
      return;
    }

    // Process users
    let processed = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    console.log("\n🔄 Processing users...\n");

    for (const userServiceUser of userServiceUsers) {
      try {
        // Validate required field
        if (!userServiceUser.tenantId) {
          console.warn(
            `⚠️  Skipping user ${userServiceUser._id}: Missing tenantId`
          );
          skipped++;
          continue;
        }

        // Map user to profile-service format
        const profileServiceUserData = mapUserToProfileService(userServiceUser);

        // Check if user already exists
        // Try by userId first (more reliable), then by email
        let existingUser = null;
        if (profileServiceUserData.userId) {
          existingUser = await ProfileServiceUser.findOne({
            tenantId: profileServiceUserData.tenantId,
            userId: profileServiceUserData.userId,
          });
        }
        
        // If not found by userId and email exists, try by email
        if (!existingUser && profileServiceUserData.userEmail) {
          existingUser = await ProfileServiceUser.findOne({
            tenantId: profileServiceUserData.tenantId,
            userEmail: profileServiceUserData.userEmail,
          });
        }

        if (existingUser) {
          // Update existing user with latest data
          Object.assign(existingUser, profileServiceUserData);
          await existingUser.save();
          updated++;
          console.log(
            `✅ Updated: ${profileServiceUserData.userEmail || profileServiceUserData.userId} (tenant: ${profileServiceUserData.tenantId})`
          );
        } else {
          // Create new user
          await ProfileServiceUser.create(profileServiceUserData);
          created++;
          console.log(
            `➕ Created: ${profileServiceUserData.userEmail || profileServiceUserData.userId} (tenant: ${profileServiceUserData.tenantId})`
          );
        }

        processed++;
      } catch (error) {
        errors++;
        const userIdentifier = userServiceUser.userEmail || userServiceUser._id;
        console.error(
          `❌ Error processing user ${userIdentifier}:`,
          error.message
        );
        
        // Log duplicate key errors more clearly
        if (error.code === 11000) {
          console.error(
            `   Duplicate key error - user may already exist with different identifier`
          );
        }
      }
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total users in User Service: ${userServiceUsers.length}`);
    console.log(`Processed: ${processed}`);
    console.log(`Created: ${created}`);
    console.log(`Updated: ${updated}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Errors: ${errors}`);
    console.log("=".repeat(60));
  } catch (error) {
    console.error("❌ Script error:", error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Close all connections
    if (connections) {
      console.log("\n🔌 Closing database connections...");
      for (const [name, conn] of Object.entries(connections)) {
        if (conn && conn.readyState === 1) {
          await conn.close();
          console.log(`✅ Closed ${name} connection`);
        }
      }
    }
  }
}

// Run the script
seedUsers()
  .then(() => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error.message);
    process.exit(1);
  });


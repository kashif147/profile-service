#!/usr/bin/env node

/**
 * Script to sync users from user-service to profile-service
 * 
 * This script:
 * 1. Connects to both user-service and profile-service databases
 * 2. Fetches all users from user-service
 * 3. Updates existing users in profile-service with latest data
 * 4. Adds new users from user-service that don't exist in profile-service
 * 5. Only syncs fields required by profile-service user model
 * 
 * Usage: 
 *   node scripts/sync-users-from-user-service.js
 */

const mongoose = require("mongoose");

// Database URIs (hardcoded)
const USER_SERVICE_URI = "mongodb+srv://kashif147:Test12**@clusterprojectshell.tptnh8w.mongodb.net/User-Service?retryWrites=true&w=majority&appName=ClusterProjectShell";
const PROFILE_SERVICE_URI = "mongodb+srv://kashif147:Test12**@clusterprojectshell.tptnh8w.mongodb.net/Profile-Service?retryWrites=true&w=majority&appName=ClusterProjectShell";

// Connect to multiple databases
async function connectToDatabases() {
  const connections = {};

  try {
    // User Service Database
    console.log("🔗 Connecting to User Service database...");
    console.log(`   URI: ${USER_SERVICE_URI.replace(/:[^:@]+@/, ":****@")}`);
    connections.userService = await mongoose.createConnection(USER_SERVICE_URI, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    });
    console.log(
      `✅ Connected to User Service: ${connections.userService.name}`
    );

    // Profile Service Database
    console.log("\n🔗 Connecting to Profile Service database...");
    console.log(`   URI: ${PROFILE_SERVICE_URI.replace(/:[^:@]+@/, ":****@")}`);
    connections.profileService = await mongoose.createConnection(
      PROFILE_SERVICE_URI,
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
  // Based on actual user.model.js from user-service
  const UserServiceUserSchema = new mongoose.Schema(
    {
      tenantId: { type: String, required: true, index: true },
      userEmail: { type: String, default: null },
      userFirstName: { type: String, default: null },
      userLastName: { type: String, default: null },
      userFullName: { type: String, default: null },
      userMobilePhone: { type: String, default: null },
      userMemberNumber: { type: String, default: null },
      userMicrosoftId: { type: String, default: null },
      userAuthProvider: { type: String, default: "microsoft" },
      userSubject: { type: String, default: null },
      userAudience: { type: String, default: null },
      userIssuer: { type: String, default: null },
      userIssuedAt: { type: Number, default: null },
      userAuthTime: { type: Number, default: null },
      userTokenVersion: { type: String, default: null },
      userPolicy: { type: String, default: null },
      userType: { type: String, enum: ["PORTAL", "CRM"], default: "PORTAL" },
      userLastLogin: { type: Date, default: Date.now },
      userLastLogout: { type: Date, default: null },
      password: { type: String },
      roles: [{ type: mongoose.Schema.Types.ObjectId, ref: "Role" }],
      isActive: { type: Boolean, default: true },
      tokens: {
        id_token: { type: String, default: null },
        refresh_token: { type: String, default: null },
        id_token_expires_in: { type: Number, default: null },
        refresh_token_expires_in: { type: Number, default: null },
      },
      createdBy: { type: String, default: null },
      updatedBy: { type: String, default: null },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now },
    },
    { collection: "users", strict: false }
  );

  const UserServiceUser =
    connections.userService.models.User ||
    connections.userService.model("User", UserServiceUserSchema);

  // Profile Service User Model
  // Based on actual user.model.js from profile-service
  // Only includes fields that profile-service actually uses
  const ProfileServiceUserSchema = new mongoose.Schema(
    {
      tenantId: { type: String, required: true, index: true },
      userId: { type: String, index: true }, // Reference to user-service user ID
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

function profileUserCreatePayload(data) {
  const uid = data.userId;
  if (uid && mongoose.Types.ObjectId.isValid(uid)) {
    return { ...data, _id: new mongoose.Types.ObjectId(uid) };
  }
  return data;
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
async function syncUsers() {
  let connections = null;

  try {
    console.log("🚀 Starting User Sync Process");
    console.log("=".repeat(60));

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

    // Fetch existing users from profile-service for comparison
    console.log("\n📊 Fetching existing users from Profile Service...");
    const existingProfileUsers = await ProfileServiceUser.find({}).lean();
    console.log(`✅ Found ${existingProfileUsers.length} users in Profile Service`);

    // Process users
    let processed = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    console.log("\n🔄 Syncing users...\n");

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
        // Try by userId first (most reliable), then by email and tenantId
        let existingUser = null;
        if (profileServiceUserData.userId) {
          existingUser = await ProfileServiceUser.findOne({
            userId: profileServiceUserData.userId,
          });
        }

        // If not found by userId and email exists, try by email and tenantId
        if (!existingUser && profileServiceUserData.userEmail) {
          existingUser = await ProfileServiceUser.findOne({
            tenantId: profileServiceUserData.tenantId,
            userEmail: profileServiceUserData.userEmail,
          });
        }

        if (existingUser) {
          // Check if update is needed
          let needsUpdate = false;
          const fieldsToUpdate = [
            'userEmail',
            'userFirstName',
            'userLastName',
            'userFullName',
            'userMobilePhone',
            'userMicrosoftId',
            'userType',
            'isActive'
          ];

          for (const field of fieldsToUpdate) {
            if (existingUser[field] !== profileServiceUserData[field]) {
              needsUpdate = true;
              break;
            }
          }

          if (needsUpdate) {
            // Update existing user with latest data from user-service
            Object.assign(existingUser, profileServiceUserData);
            await existingUser.save();
            updated++;
            console.log(
              `✏️  Updated: ${profileServiceUserData.userEmail || profileServiceUserData.userId} (tenant: ${profileServiceUserData.tenantId})`
            );
          } else {
            skipped++;
          }
        } else {
          await ProfileServiceUser.create(
            profileUserCreatePayload(profileServiceUserData)
          );
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
    console.log("📊 SYNC SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total users in User Service: ${userServiceUsers.length}`);
    console.log(`Total users in Profile Service (before): ${existingProfileUsers.length}`);
    console.log(`Processed: ${processed}`);
    console.log(`✅ Created (new users): ${created}`);
    console.log(`✏️  Updated (existing users): ${updated}`);
    console.log(`⏭️  Skipped (no changes): ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log("=".repeat(60));

    const finalCount = await ProfileServiceUser.countDocuments();
    console.log(`\n📈 Total users in Profile Service (after): ${finalCount}`);

  } catch (error) {
    console.error("\n❌ Script error:", error.message);
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
syncUsers()
  .then(() => {
    console.log("\n✅ Sync completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Sync failed:", error.message);
    process.exit(1);
  });

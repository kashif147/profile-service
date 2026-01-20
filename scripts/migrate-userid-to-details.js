/**
 * Migration Script: Update userId in PersonalDetails, ProfessionalDetails, and SubscriptionDetails
 * 
 * This script links existing application records to users by:
 * 1. Finding PersonalDetails by email
 * 2. Getting the userId from the User table
 * 3. Updating PersonalDetails, ProfessionalDetails, and SubscriptionDetails with the userId
 * 
 * Run this script ONCE to fix existing data.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/user.model");
const PersonalDetails = require("../models/personal.details.model");
const ProfessionalDetails = require("../models/professional.details.model");
const SubscriptionDetails = require("../models/subscription.model");

async function migrateUserIds() {
  try {
    console.log("🚀 Starting userId migration for PersonalDetails, ProfessionalDetails, and SubscriptionDetails...");
    
    // Connect to database
    const MONGODB_URI = process.env.MONGODB_URI || process.env.DATABASE_URL;
    if (!MONGODB_URI) {
      throw new Error("MONGODB_URI or DATABASE_URL environment variable is required");
    }

    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to database");

    let stats = {
      personalDetailsUpdated: 0,
      professionalDetailsUpdated: 0,
      subscriptionDetailsUpdated: 0,
      personalDetailsSkipped: 0,
      professionalDetailsSkipped: 0,
      subscriptionDetailsSkipped: 0,
      errors: 0,
    };

    // Get all users with email
    const users = await User.find({ userEmail: { $ne: null } });
    console.log(`📊 Found ${users.length} users with email addresses`);

    for (const user of users) {
      try {
        if (!user.userEmail) continue;

        const normalizedEmail = user.userEmail.toLowerCase();
        console.log(`\n🔍 Processing user: ${user.userEmail} (${user.userId})`);

        // Find PersonalDetails by email
        const personalDetails = await PersonalDetails.findOne({
          $or: [
            { "contactInfo.personalEmail": new RegExp(`^${normalizedEmail}$`, "i") },
            { "contactInfo.workEmail": new RegExp(`^${normalizedEmail}$`, "i") },
          ],
          "meta.deleted": { $ne: true },
        });

        if (!personalDetails) {
          console.log(`  ℹ️  No PersonalDetails found for ${user.userEmail}`);
          continue;
        }

        console.log(`  📋 Found PersonalDetails: ${personalDetails._id}`);

        // Update PersonalDetails with userId if not already set
        if (!personalDetails.userId || String(personalDetails.userId) !== String(user.userId)) {
          await PersonalDetails.updateOne(
            { _id: personalDetails._id },
            { $set: { userId: user.userId } }
          );
          console.log(`  ✅ Updated PersonalDetails with userId: ${user.userId}`);
          stats.personalDetailsUpdated++;
        } else {
          console.log(`  ⏭️  PersonalDetails already has userId: ${personalDetails.userId}`);
          stats.personalDetailsSkipped++;
        }

        // Get applicationId from PersonalDetails
        if (!personalDetails.applicationId) {
          console.log(`  ⚠️  PersonalDetails has no applicationId, skipping ProfessionalDetails and SubscriptionDetails`);
          continue;
        }

        console.log(`  🔗 ApplicationId: ${personalDetails.applicationId}`);

        // Update ProfessionalDetails by applicationId
        const professionalDetails = await ProfessionalDetails.findOne({
          applicationId: personalDetails.applicationId,
        });

        if (professionalDetails) {
          if (!professionalDetails.userId || String(professionalDetails.userId) !== String(user.userId)) {
            await ProfessionalDetails.updateOne(
              { _id: professionalDetails._id },
              { $set: { userId: user.userId } }
            );
            console.log(`  ✅ Updated ProfessionalDetails with userId: ${user.userId}`);
            stats.professionalDetailsUpdated++;
          } else {
            console.log(`  ⏭️  ProfessionalDetails already has userId: ${professionalDetails.userId}`);
            stats.professionalDetailsSkipped++;
          }
        } else {
          console.log(`  ℹ️  No ProfessionalDetails found for applicationId: ${personalDetails.applicationId}`);
        }

        // Update SubscriptionDetails by applicationId
        const subscriptionDetails = await SubscriptionDetails.findOne({
          applicationId: personalDetails.applicationId,
        });

        if (subscriptionDetails) {
          if (!subscriptionDetails.userId || String(subscriptionDetails.userId) !== String(user.userId)) {
            await SubscriptionDetails.updateOne(
              { _id: subscriptionDetails._id },
              { $set: { userId: user.userId } }
            );
            console.log(`  ✅ Updated SubscriptionDetails with userId: ${user.userId}`);
            stats.subscriptionDetailsUpdated++;
          } else {
            console.log(`  ⏭️  SubscriptionDetails already has userId: ${subscriptionDetails.userId}`);
            stats.subscriptionDetailsSkipped++;
          }
        } else {
          console.log(`  ℹ️  No SubscriptionDetails found for applicationId: ${personalDetails.applicationId}`);
        }

      } catch (error) {
        console.error(`  ❌ Error processing user ${user.userEmail}:`, error.message);
        stats.errors++;
      }
    }

    console.log("\n\n📊 Migration Summary:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`PersonalDetails:`);
    console.log(`  ✅ Updated: ${stats.personalDetailsUpdated}`);
    console.log(`  ⏭️  Skipped: ${stats.personalDetailsSkipped}`);
    console.log(`ProfessionalDetails:`);
    console.log(`  ✅ Updated: ${stats.professionalDetailsUpdated}`);
    console.log(`  ⏭️  Skipped: ${stats.professionalDetailsSkipped}`);
    console.log(`SubscriptionDetails:`);
    console.log(`  ✅ Updated: ${stats.subscriptionDetailsUpdated}`);
    console.log(`  ⏭️  Skipped: ${stats.subscriptionDetailsSkipped}`);
    console.log(`Errors: ${stats.errors}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\n✅ Migration completed successfully!");

  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    throw error;
  } finally {
    await mongoose.connection.close();
    console.log("🔌 Database connection closed");
  }
}

// Run the migration
migrateUserIds()
  .then(() => {
    console.log("\n🎉 All done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Migration failed:", error);
    process.exit(1);
  });

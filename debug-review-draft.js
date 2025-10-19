#!/usr/bin/env node

/**
 * Debug script for the review-draft endpoint
 * This script helps identify the root cause of the 500 error
 */

const axios = require("axios");

// Configuration
const BASE_URL =
  "https://profileserviceshell-bqfmh8apf9erf0b0.northeurope-01.azurewebsites.net";
const APPLICATION_ID = "your-application-id-here"; // Replace with actual application ID

// Test data - adjust based on your actual data structure
const testPayload = {
  submission: {
    personalInfo: {
      firstName: "John",
      lastName: "Doe",
    },
    contactInfo: {
      personalEmail: "john.doe@example.com",
    },
    professionalDetails: {},
    subscriptionDetails: {},
  },
  effectiveDocument: {
    personalInfo: {
      firstName: "John",
      lastName: "Doe Updated",
    },
    contactInfo: {
      personalEmail: "john.doe@example.com",
    },
    professionalDetails: {},
    subscriptionDetails: {},
  },
  notes: "Test review draft",
};

async function testReviewDraft() {
  console.log("🔍 Testing review-draft endpoint...");
  console.log(
    `📍 URL: ${BASE_URL}/api/applications/${APPLICATION_ID}/review-draft`
  );
  console.log(`📦 Payload:`, JSON.stringify(testPayload, null, 2));

  try {
    const response = await axios.post(
      `${BASE_URL}/api/applications/${APPLICATION_ID}/review-draft`,
      testPayload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer YOUR_JWT_TOKEN_HERE", // Replace with actual token
          "x-correlation-id": "debug-test-" + Date.now(),
        },
        timeout: 30000,
      }
    );

    console.log("✅ Success!");
    console.log("📊 Status:", response.status);
    console.log("📄 Response:", JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log("❌ Error occurred:");

    if (error.response) {
      console.log("📊 Status:", error.response.status);
      console.log("📄 Response:", JSON.stringify(error.response.data, null, 2));
      console.log("🔗 URL:", error.config?.url);
      console.log(
        "📦 Request Payload:",
        JSON.stringify(JSON.parse(error.config?.data || "{}"), null, 2)
      );
    } else if (error.request) {
      console.log("🌐 Network Error:", error.message);
      console.log("🔗 URL:", error.config?.url);
    } else {
      console.log("⚠️ Setup Error:", error.message);
    }

    console.log("\n🔍 Debugging Steps:");
    console.log(
      "1. Check the Azure App Service logs for detailed error information"
    );
    console.log("2. Verify the applicationId exists in the database");
    console.log("3. Check if JWT token is valid and has proper permissions");
    console.log("4. Ensure MongoDB connection is working");
    console.log("5. Verify the payload structure matches the expected schema");
    console.log("\n📋 Error Details:");
    if (error.response?.data?.error) {
      console.log("   Code:", error.response.data.error.code);
      console.log("   Status:", error.response.data.error.status);
      console.log("   Message:", error.response.data.error.message);
      if (error.response.data.error.missingPaths) {
        console.log(
          "   Missing Paths:",
          error.response.data.error.missingPaths
        );
      }
      if (error.response.data.error.originalError) {
        console.log(
          "   Original Error:",
          error.response.data.error.originalError
        );
      }
    }
  }
}

// Health check first
async function testHealthCheck() {
  console.log("🏥 Testing health check...");
  try {
    const response = await axios.get(`${BASE_URL}/health`);
    console.log("✅ Health check passed:", response.data);
  } catch (error) {
    console.log("❌ Health check failed:", error.message);
  }
}

async function main() {
  console.log("🚀 Starting debug session...\n");

  await testHealthCheck();
  console.log("\n" + "=".repeat(50) + "\n");

  if (APPLICATION_ID === "your-application-id-here") {
    console.log(
      "⚠️ Please update APPLICATION_ID in this script with a real application ID"
    );
    console.log("⚠️ Please update the JWT token in the Authorization header");
    return;
  }

  await testReviewDraft();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testReviewDraft, testHealthCheck };

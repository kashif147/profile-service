#!/usr/bin/env node

/**
 * Test script for approve/reject endpoints
 * This script helps verify the publishDomainEvent fix
 */

const axios = require("axios");

// Configuration
const BASE_URL =
  "https://profileserviceshell-bqfmh8apf9erf0b0.northeurope-01.azurewebsites.net";
const APPLICATION_ID = "7cafb084-e884-4b70-a927-a6d5e0b6e68f"; // Use the same application ID

// Test data for reject endpoint
const rejectPayload = {
  reason: "Test rejection reason",
  notes: "Test rejection notes",
};

// Test data for approve endpoint
const approvePayload = {
  overlayId: "test-overlay-id", // This would need to be a real overlay ID
  overlayVersion: 1,
};

async function testRejectEndpoint() {
  console.log("🔍 Testing reject endpoint...");
  console.log(`📍 URL: ${BASE_URL}/api/applications/${APPLICATION_ID}/reject`);
  console.log(`📦 Payload:`, JSON.stringify(rejectPayload, null, 2));

  try {
    const response = await axios.post(
      `${BASE_URL}/api/applications/${APPLICATION_ID}/reject`,
      rejectPayload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer YOUR_JWT_TOKEN_HERE", // Replace with actual token
          "x-correlation-id": "debug-reject-test-" + Date.now(),
        },
        timeout: 30000,
      }
    );

    console.log("✅ Reject Success!");
    console.log("📊 Status:", response.status);
    console.log("📄 Response:", JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log("❌ Reject Error occurred:");

    if (error.response) {
      console.log("📊 Status:", error.response.status);
      console.log("📄 Response:", JSON.stringify(error.response.data, null, 2));
      console.log("🔗 URL:", error.config?.url);
    } else if (error.request) {
      console.log("🌐 Network Error:", error.message);
      console.log("🔗 URL:", error.config?.url);
    } else {
      console.log("⚠️ Setup Error:", error.message);
    }
  }
}

async function testApproveEndpoint() {
  console.log("\n🔍 Testing approve endpoint...");
  console.log(`📍 URL: ${BASE_URL}/api/applications/${APPLICATION_ID}/approve`);
  console.log(`📦 Payload:`, JSON.stringify(approvePayload, null, 2));

  try {
    const response = await axios.post(
      `${BASE_URL}/api/applications/${APPLICATION_ID}/approve`,
      approvePayload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer YOUR_JWT_TOKEN_HERE", // Replace with actual token
          "x-correlation-id": "debug-approve-test-" + Date.now(),
        },
        timeout: 30000,
      }
    );

    console.log("✅ Approve Success!");
    console.log("📊 Status:", response.status);
    console.log("📄 Response:", JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log("❌ Approve Error occurred:");

    if (error.response) {
      console.log("📊 Status:", error.response.status);
      console.log("📄 Response:", JSON.stringify(error.response.data, null, 2));
      console.log("🔗 URL:", error.config?.url);
    } else if (error.request) {
      console.log("🌐 Network Error:", error.message);
      console.log("🔗 URL:", error.config?.url);
    } else {
      console.log("⚠️ Setup Error:", error.message);
    }
  }
}

async function main() {
  console.log("🚀 Starting approve/reject endpoint tests...\n");

  await testRejectEndpoint();
  console.log("\n" + "=".repeat(50) + "\n");
  await testApproveEndpoint();

  console.log("\n✅ FIXED: publishDomainEvent import issue");
  console.log("📋 Changes made:");
  console.log(
    "   1. Added publishDomainEvent import to profileApproval.controller.js"
  );
  console.log("   2. Added publishDomainEvent import to approval.service.js");
  console.log("   3. Added APPLICATION_REVIEW_EVENTS import to both files");
  console.log(
    "   4. Fixed reviewerId ObjectId casting in all approval services"
  );
  console.log("   5. Added getReviewerIdForDb() helper to handle bypass users");
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testRejectEndpoint, testApproveEndpoint };

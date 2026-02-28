#!/bin/bash

# Test script for Profile-Service validation endpoint
# Tests duplicate detection for email, mobile, and membership number in Profile collection
# Usage: ./test-profile-validation.sh [environment]

ENVIRONMENT=${1:-local}

# Set API endpoint based on environment
if [ "$ENVIRONMENT" = "local" ]; then
    API_URL="http://localhost:3002/api/profile/validate"
elif [ "$ENVIRONMENT" = "dev" ]; then
    API_URL="https://your-profile-dev-url.azurewebsites.net/api/profile/validate"
elif [ "$ENVIRONMENT" = "production" ]; then
    API_URL="https://your-profile-prod-url.azurewebsites.net/api/profile/validate"
else
    echo "Unknown environment: $ENVIRONMENT"
    exit 1
fi

echo "Testing Profile-Service Validation: $API_URL"
echo "=============================================="
echo ""

# Test 1: New member with unique data
echo "Test 1: New Member - All Unique Data (HTTP 200, action=Continue)"
echo "-----------------------------------------------------------------"
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "email": "newmember@example.com",
    "mobileNumber": "+1999888777",
    "membershipNumber": "MEM-NEW-999",
    "step": "PostAttributeCollection"
  }' \
  -s | jq . 2>/dev/null || echo "JSON parse error"

echo ""
echo ""

# Test 2: Duplicate email (should block)
echo "Test 2: Duplicate Email (HTTP 200, action=ShowBlockPage)"
echo "---------------------------------------------------------"
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "email": "existing.member@example.com",
    "mobileNumber": "+1999999999",
    "membershipNumber": "MEM-UNIQUE-001",
    "step": "PostAttributeCollection"
  }' \
  -s | jq . 2>/dev/null || echo "JSON parse error"

echo ""
echo ""

# Test 3: Duplicate mobile number
echo "Test 3: Duplicate Mobile Number (HTTP 200, action=ShowBlockPage)"
echo "-----------------------------------------------------------------"
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "email": "uniqueemail@example.com",
    "mobileNumber": "+1234567890",
    "membershipNumber": "MEM-UNIQUE-002",
    "step": "PostAttributeCollection"
  }' \
  -s | jq . 2>/dev/null || echo "JSON parse error"

echo ""
echo ""

# Test 4: Duplicate membership number
echo "Test 4: Duplicate Membership Number (HTTP 200, action=ShowBlockPage)"
echo "---------------------------------------------------------------------"
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "email": "anotheremail@example.com",
    "mobileNumber": "+1888777666",
    "membershipNumber": "MEM-123456",
    "step": "PostAttributeCollection"
  }' \
  -s | jq . 2>/dev/null || echo "JSON parse error"

echo ""
echo ""

# Test 5: Invalid email format
echo "Test 5: Invalid Email Format (HTTP 200, status=400, action=ValidationError)"
echo "---------------------------------------------------------------------------"
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "email": "invalid-email",
    "mobileNumber": "+1234567890",
    "step": "PostAttributeCollection"
  }' \
  -s | jq . 2>/dev/null || echo "JSON parse error"

echo ""
echo ""

# Test 6: Missing email
echo "Test 6: Missing Email (HTTP 200, status=400, action=ValidationError)"
echo "---------------------------------------------------------------------"
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "mobileNumber": "+1234567890",
    "membershipNumber": "MEM-123",
    "step": "PostAttributeCollection"
  }' \
  -s | jq . 2>/dev/null || echo "JSON parse error"

echo ""
echo ""

# Test 7: Invalid mobile format
echo "Test 7: Invalid Mobile Format (HTTP 200, status=400, action=ValidationError)"
echo "-----------------------------------------------------------------------------"
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "email": "test@example.com",
    "mobileNumber": "123",
    "step": "PostAttributeCollection"
  }' \
  -s | jq . 2>/dev/null || echo "JSON parse error"

echo ""
echo ""

# Test 8: Invalid membership number format
echo "Test 8: Invalid Membership Format (HTTP 200, status=400, action=ValidationError)"
echo "---------------------------------------------------------------------------------"
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "email": "test@example.com",
    "membershipNumber": "AB",
    "step": "PostAttributeCollection"
  }' \
  -s | jq . 2>/dev/null || echo "JSON parse error"

echo ""
echo ""

# Test 9: Extension attributes format
echo "Test 9: Azure B2C Extension Attributes Format"
echo "----------------------------------------------"
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "email": "newmember2@example.com",
    "extension_a1b2c3d4_mobileNumber": "+1555444333",
    "extension_a1b2c3d4_membershipNumber": "MEM-EXT-001",
    "step": "PostAttributeCollection"
  }' \
  -s | jq . 2>/dev/null || echo "JSON parse error"

echo ""
echo ""
echo "Testing complete!"
echo ""
echo "Expected Results Summary:"
echo "========================="
echo ""
echo "✅ Test 1: HTTP 200, action=Continue - New member allowed"
echo "🚫 Test 2: HTTP 200, action=ShowBlockPage - Duplicate email"
echo "🚫 Test 3: HTTP 200, action=ShowBlockPage - Duplicate mobile"
echo "🚫 Test 4: HTTP 200, action=ShowBlockPage - Duplicate membership #"
echo "❌ Test 5: HTTP 200, status=400, action=ValidationError - Invalid email"
echo "❌ Test 6: HTTP 200, status=400, action=ValidationError - Missing email"
echo "❌ Test 7: HTTP 200, status=400, action=ValidationError - Invalid mobile"
echo "❌ Test 8: HTTP 200, status=400, action=ValidationError - Invalid membership #"
echo "✅ Test 9: HTTP 200, action=Continue - Extension attributes work"
echo ""
echo "Note: Tests 2-4 depend on having existing profiles in your database."
echo "Adjust test data based on your actual Profile collection contents."

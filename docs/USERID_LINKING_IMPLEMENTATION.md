# User ID Linking Implementation

## Overview

This document explains how `userId` is automatically linked to PersonalDetails, ProfessionalDetails, and SubscriptionDetails when a user logs in, regardless of whether they are a Portal user or CRM user.

## Problem Statement

When a CRM user creates an application for a user who doesn't exist in the portal yet:
1. Application is created with `userId = NULL` in PersonalDetails, ProfessionalDetails, and SubscriptionDetails
2. When that user logs in, the `userId` needs to be populated in all three tables
3. This allows the user to retrieve their details using GET endpoints

## Solution Architecture

### Flow Diagram

```
User Logs In (Portal/CRM)
         ↓
User Service publishes event
   • PORTAL_USER_CREATED (for Portal users)
   • CRM_USER_CREATED (for CRM users)
         ↓
Profile Service listener receives event
         ↓
1. Update User table with userId
         ↓
2. Find & Update Profile by email
         ↓
3. Find PersonalDetails by email
         ↓
4. Update PersonalDetails with userId
         ↓
5. Get applicationId from PersonalDetails
         ↓
6. Find & Update ProfessionalDetails (by applicationId)
         ↓
7. Find & Update SubscriptionDetails (by applicationId)
         ↓
✅ All tables now have userId linked
```

## Implementation Details

### 1. Portal User Login Flow

**File:** `profile-service/rabbitMQ/listeners/user.portal.listener.js`

**Event:** `PORTAL_USER_CREATED` or `PORTAL_USER_UPDATED`

**Logic:**
```javascript
// Step 1: Create/update User in profile-service
await User.findOneAndUpdate({ tenantId, userId }, { $set: { ... } });

// Step 2: Find Profile by email and link userId
const profile = await Profile.findOne({ tenantId, normalizedEmail });
if (profile && !profile.userId) {
  await Profile.updateOne({ _id: profile._id }, { $set: { userId } });
}

// Step 3: Find PersonalDetails by email (personalEmail or workEmail)
const personalDetails = await PersonalDetails.findOne({
  $or: [
    { "contactInfo.personalEmail": /email/i },
    { "contactInfo.workEmail": /email/i }
  ]
});

// Step 4: Update PersonalDetails with userId
if (personalDetails && !personalDetails.userId) {
  await PersonalDetails.updateOne({ _id: personalDetails._id }, { $set: { userId } });
}

// Step 5: Update ProfessionalDetails by applicationId
if (personalDetails.applicationId) {
  const professionalDetails = await ProfessionalDetails.findOne({
    applicationId: personalDetails.applicationId
  });
  if (professionalDetails && !professionalDetails.userId) {
    await ProfessionalDetails.updateOne({ _id: professionalDetails._id }, { $set: { userId } });
  }
}

// Step 6: Update SubscriptionDetails by applicationId
const subscriptionDetails = await SubscriptionDetails.findOne({
  applicationId: personalDetails.applicationId
});
if (subscriptionDetails && !subscriptionDetails.userId) {
  await SubscriptionDetails.updateOne({ _id: subscriptionDetails._id }, { $set: { userId } });
}
```

### 2. CRM User Login Flow

**File:** `profile-service/rabbitMQ/listeners/user.crm.listener.js`

**Event:** `CRM_USER_CREATED` or `CRM_USER_UPDATED`

**Logic:** Same as Portal User Login Flow (see above)

**New Implementation:** Previously, CRM listener only updated User and Profile tables. Now it also updates PersonalDetails, ProfessionalDetails, and SubscriptionDetails.

### 3. Email Matching Strategy

The system finds PersonalDetails by matching the user's login email with:
- `contactInfo.personalEmail` (case-insensitive)
- `contactInfo.workEmail` (case-insensitive)

```javascript
const personalDetails = await PersonalDetails.findOne({
  $or: [
    { "contactInfo.personalEmail": new RegExp(`^${normalizedEmail}$`, "i") },
    { "contactInfo.workEmail": new RegExp(`^${normalizedEmail}$`, "i") },
  ],
  "meta.deleted": { $ne: true },
});
```

### 4. Application ID Linking

Once PersonalDetails is found, the `applicationId` is used to link:
- **ProfessionalDetails:** `{ applicationId: personalDetails.applicationId }`
- **SubscriptionDetails:** `{ applicationId: personalDetails.applicationId }`

This ensures all three tables for the same application are linked to the user.

## Retrieval Logic

### GET Endpoints

All three handlers have `getByUserId` methods:

**PersonalDetailsHandler:**
```javascript
exports.getByUserId = (userId) => {
  const userIdQuery = mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : userId;
  
  return PersonalDetails.findOne({ 
    userId: userIdQuery,
    "meta.deleted": { $ne: true }
  });
};
```

**ProfessionalDetailsHandler:**
```javascript
exports.getByUserId = (userId) => {
  const userIdQuery = mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : userId;
  
  return ProfessionalDetails.findOne({ 
    userId: userIdQuery,
    "meta.deleted": { $ne: true }
  });
};
```

**SubscriptionDetailsHandler:**
```javascript
exports.getByUserId = (userId) => {
  const userIdQuery = mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : userId;
  
  return SubscriptionDetails.findOne({ 
    userId: userIdQuery,
    "meta.deleted": { $ne: true }
  });
};
```

## Migration for Existing Data

### Script Location
`profile-service/scripts/migrate-userid-to-details.js`

### Purpose
Updates existing records that have NULL `userId` values by matching emails from the User table.

### How to Run
```bash
cd profile-service
node scripts/migrate-userid-to-details.js
```

### What It Does
1. Fetches all users from User table
2. For each user with an email:
   - Finds PersonalDetails by email match
   - Updates PersonalDetails with userId
   - Uses applicationId to find ProfessionalDetails
   - Updates ProfessionalDetails with userId
   - Uses applicationId to find SubscriptionDetails
   - Updates SubscriptionDetails with userId
3. Provides detailed statistics on updates

## Testing

### Manual Testing Steps

1. **Create Application as CRM User:**
   ```
   POST /api/personal-details/:applicationId
   - Creates PersonalDetails with userId = NULL
   - Creates ProfessionalDetails with userId = NULL
   - Creates SubscriptionDetails with userId = NULL
   ```

2. **User Logs In:**
   ```
   - User-service publishes PORTAL_USER_CREATED or CRM_USER_CREATED event
   - Profile-service listener processes event
   - Updates userId in all three tables
   ```

3. **Verify Updates:**
   ```
   GET /api/personal-details/user/:userId
   GET /api/professional-details/user/:userId
   GET /api/subscription-details/user/:userId
   
   All should return data with userId populated
   ```

### Logging

Check console logs for:
- `✅ Linked Portal/CRM user ${userId} to PersonalDetails: ${personalDetails._id}`
- `✅ Linked Portal/CRM user ${userId} to ProfessionalDetails: ${professionalDetails._id}`
- `✅ Linked Portal/CRM user ${userId} to SubscriptionDetails: ${subscriptionDetails._id}`

Or:
- `ℹ️ PersonalDetails already linked to Portal/CRM user ${userId}`
- `ℹ️ ProfessionalDetails already linked to Portal/CRM user ${userId}`
- `ℹ️ SubscriptionDetails already linked to Portal/CRM user ${userId}`

## Edge Cases Handled

1. **Email Mismatch:** If login email doesn't match application email, userId won't be linked
2. **Missing ApplicationId:** If PersonalDetails has no applicationId, Professional/Subscription won't be updated
3. **Already Linked:** If userId already exists, no update is performed
4. **Case Insensitive:** Email matching is case-insensitive
5. **Deleted Records:** Only active records (meta.deleted != true) are updated

## Troubleshooting

### Issue: userId Not Being Updated

**Check:**
1. Is RabbitMQ running and connected?
2. Are events being published from user-service?
3. Is profile-service listener registered and consuming events?
4. Does the email in PersonalDetails match the login email?
5. Check console logs for error messages

**Solutions:**
1. Restart profile-service to ensure listeners are registered
2. Check RabbitMQ queues for stuck messages
3. Run migration script to manually fix existing data
4. Verify email addresses match exactly (case-insensitive)

### Issue: GET Endpoints Return Null

**Check:**
1. Is userId populated in the database?
2. Is the correct userId being passed to the GET endpoint?
3. Is meta.deleted = true for the record?

**Solutions:**
1. Run migration script to populate userId
2. Check database directly: `db.personaldetails.findOne({ userId: ObjectId("...") })`
3. Verify userId is ObjectId type, not string

## Files Modified

1. ✅ `profile-service/rabbitMQ/listeners/user.crm.listener.js` - Added PersonalDetails, ProfessionalDetails, SubscriptionDetails linking
2. ✅ `profile-service/rabbitMQ/listeners/user.portal.listener.js` - Already had the logic (verified)
3. ✅ `profile-service/handlers/personal.details.handler.js` - Already has getByUserId (verified)
4. ✅ `profile-service/handlers/professional.details.handler.js` - Already has getByUserId (verified)
5. ✅ `profile-service/handlers/subscription.details.handler.js` - Already has getByUserId (verified)
6. ✅ `profile-service/scripts/migrate-userid-to-details.js` - NEW migration script

## Summary

The implementation ensures that whenever a user logs in (Portal or CRM), their `userId` is automatically linked to their PersonalDetails, ProfessionalDetails, and SubscriptionDetails records. This allows users to retrieve their details using simple GET requests with their `userId`, making the API more intuitive and user-friendly.

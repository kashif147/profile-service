/**
 * USER ID LINKING LOGIC IN PROFILE SERVICE
 * ==========================================
 * 
 * This explains how userId is added to a profile when a user logs in,
 * even though the profile was initially created with userId = null by a CRM user.
 */

// ============================================================================
// STEP 1: PROFILE CREATION (CRM User Creates Application)
// ============================================================================
// Location: profile-service/services/profileLookup.service.js
// 
// When a CRM user creates/approves an application, a profile is created:
// - userId is set to null (because it's created by CRM, not by the portal user)
// - Only crmUserId is set (the ID of the CRM user who approved it)
// - Profile is created with personal, professional, and subscription details

async function findOrCreateProfileByEmail({ tenantId, effective, reviewerId, session }) {
  // ... profile creation logic ...
  
  const doc = {
    tenantId,
    normalizedEmail: nEmail,
    personalInfo: flattened.personalInfo || {},
    contactInfo: flattened.contactInfo || {},
    professionalDetails: flattened.professionalDetails || {},
    // ... other fields ...
    userId: null,  // ← Initially NULL when created by CRM user
    crmUserId: reviewerId,  // ← Set to CRM user who approved
  };

  // Only set userId if it's a PORTAL user creating their own profile
  if (userType === "PORTAL" && userId) {
    doc.userId = userId;
  }
  
  profile = await Profile.create([doc], { session });
}

// ============================================================================
// STEP 2: USER LOGIN (Portal User Logs In)
// ============================================================================
// Location: user-service/handlers/b2c.users.handler.js
//
// When a portal user logs in through Azure B2C:
// 1. User-service finds or creates the user
// 2. Publishes a "USER_PORTAL_CREATED" event via RabbitMQ

async function findOrCreateUser(profile, tokens) {
  // ... user creation/update logic ...
  
  if (isNewUser) {
    // Publish Portal user created event
    await publishPortalUserCreated(user);  // ← Event published here
  } else {
    // Publish Portal user updated event
    await publishPortalUserUpdated(user, previousValues);
  }
}

// Event payload includes:
// {
//   userId: user._id.toString(),
//   userEmail: user.userEmail,
//   userMemberNumber: user.userMemberNumber,
//   tenantId: user.tenantId,
//   ... other user fields
// }

// ============================================================================
// STEP 3: PROFILE SERVICE LISTENS TO EVENT (Links userId to Profile)
// ============================================================================
// Location: profile-service/rabbitMQ/listeners/user.portal.listener.js
//
// Profile service listens to "USER_PORTAL_CREATED" event and:
// 1. Creates/updates the User record in profile-service
// 2. Finds the profile by email or membership number
// 3. Links the userId to the profile if found

async function handlePortalUserCreated(payload) {
  const { data } = payload;
  const {
    userId,           // ← User ID from user-service
    userEmail,        // ← User's email
    userMemberNumber, // ← User's membership number (if available)
    tenantId,
  } = data;

  // Step 1: Create/update User record in profile-service
  await User.findOneAndUpdate(
    { tenantId, userId: userId },
    {
      $set: {
        userId: userId,
        userEmail: userEmail || null,
        userFullName: userFullName || null,
        // ... other user fields
        userType: "PORTAL",
      },
    },
    { upsert: true, new: true }
  );

  // Step 2: Find profile by email or membership number
  if (userEmail || userMemberNumber) {
    const normalizedEmail = userEmail ? userEmail.toLowerCase() : null;
    
    const profile = await Profile.findOne({
      tenantId,
      $or: [
        ...(normalizedEmail ? [{ normalizedEmail }] : []),
        ...(userMemberNumber ? [{ membershipNumber: userMemberNumber }] : []),
      ],
    });

    // Step 3: Link userId to profile if found
    if (profile) {
      // Update profile with userId if not already set
      if (!profile.userId || String(profile.userId) !== String(userId)) {
        await Profile.updateOne(
          { _id: profile._id },
          { $set: { userId: userId } }  // ← THIS IS WHERE userId IS ADDED
        );
        console.log(`✅ Linked Portal user ${userId} to profile: ${profile._id}`);
      }
    }
  }
}

// ============================================================================
// SUMMARY OF THE FLOW
// ============================================================================
//
// 1. CRM User creates application
//    → Profile created with userId = null, crmUserId = CRM user ID
//
// 2. Portal User logs in
//    → User-service publishes USER_PORTAL_CREATED event
//
// 3. Profile Service receives event
//    → Finds profile by email/membership number
//    → Updates profile.userId with the portal user's ID
//
// 4. Result
//    → Profile now has both:
//       - userId: Portal user's ID (linked when they logged in)
//       - crmUserId: CRM user's ID (set when profile was created)
//
// ============================================================================
// KEY FILES
// ============================================================================
//
// Profile Creation (userId = null):
//   - profile-service/services/profileLookup.service.js (lines 24-126)
//   - profile-service/services/approval.service.js (lines 53-321)
//
// User Login Event Publishing:
//   - user-service/handlers/b2c.users.handler.js (line 284)
//   - user-service/rabbitMQ/publishers/user.portal.publisher.js (line 7)
//
// Profile Linking (userId added):
//   - profile-service/rabbitMQ/listeners/user.portal.listener.js (lines 8-103)
//   - Specifically lines 75-80: The updateOne that sets userId
//
// ============================================================================
// PROFILE MODEL STRUCTURE
// ============================================================================
//
// Profile Schema (profile-service/models/profile.model.js):
// {
//   userId: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: "users",
//     required: false,
//     default: null,  // ← Starts as null
//   }, // Azure B2C ID (Portal user)
//   
//   crmUserId: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: "User",
//     required: false,
//     default: null,
//   }, // ID of the CRM user who approved this profile
//   
//   normalizedEmail: { type: String, required: true },  // ← Used for matching
//   membershipNumber: { type: String, unique: true },    // ← Also used for matching
//   // ... personal, professional, subscription details
// }


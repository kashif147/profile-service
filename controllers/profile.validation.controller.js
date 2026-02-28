const Profile = require("../models/profile.model");
const { normalizeEmail } = require("../helpers/profileLookup.service.js");

const CONTINUE_RESPONSE = { version: "1.0.0", action: "Continue" };

function send(res, payload) {
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({ ...payload });
}

exports.validateProfile = async (req, res) => {
  const requestId = `b2c-profile-${Date.now()}-${Math.random()
    .toString(36)
    .substr(2, 9)}`;
  const startTime = Date.now();

  try {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`[${requestId}] === Azure B2C Profile Validation ===`);
    console.log(`[${requestId}] Timestamp: ${new Date().toISOString()}`);
    console.log(
      `[${requestId}] Request body:`,
      JSON.stringify(req.body, null, 2)
    );

    // Extract fields from Azure B2C request
    const { email, tenantId, step, ...claims } = req.body || {};
    
    // Extract mobile number and membership number from extension attributes or direct fields
    let mobileNumber = null;
    let membershipNumber = null;

    // Scan for extension attributes (format: extension_<appId>_<AttributeName>)
    for (const [key, value] of Object.entries(req.body)) {
      if (key.startsWith("extension_")) {
        const lowerKey = key.toLowerCase();
        // Match mobileNumber/mobilePhone (case insensitive)
        if (
          lowerKey.includes("mobilenumber") ||
          lowerKey.includes("mobilephone") ||
          lowerKey.endsWith("_mobilenumber") ||
          lowerKey.endsWith("_mobilephone")
        ) {
          mobileNumber = value;
        }
        // Match membershipNumber/memberNumber (case insensitive)
        if (
          lowerKey.includes("membershipnumber") ||
          lowerKey.includes("membernumber") ||
          lowerKey.includes("memberno") ||
          lowerKey.endsWith("_membershipnumber") ||
          lowerKey.endsWith("_membernumber") ||
          lowerKey.endsWith("_memberno")
        ) {
          membershipNumber = value;
        }
      }
    }

    // Fallback to direct field names if extension attributes not found
    mobileNumber = mobileNumber || req.body.mobileNumber || req.body.mobilephone || req.body.mobilePhone || null;
    membershipNumber = membershipNumber || req.body.membershipNumber || req.body.memberno || req.body.memberNo || null;

    console.log(`[${requestId}] 📋 Extracted fields:`, {
      email: email || "not provided",
      mobileNumber: mobileNumber || "not provided",
      membershipNumber: membershipNumber || "not provided",
      tenantId: tenantId || "not provided",
      step: step || "not provided",
    });

    // Validate required email field
    if (!email) {
      console.log(`[${requestId}] ❌ Validation failed: Email is required`);
      return send(res, {
        version: "1.0.0",
        status: 400,
        action: "ValidationError",
        userMessage: "Email is required.",
      });
    }

    // Validate email format
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      console.log(`[${requestId}] ❌ Validation failed: Invalid email format`);
      return send(res, {
        version: "1.0.0",
        status: 400,
        action: "ValidationError",
        userMessage: "Please enter a valid email address.",
      });
    }

    // Validate mobile number format if provided
    if (mobileNumber && !/^\+?[\d\s\-\(\)]{10,}$/.test(mobileNumber)) {
      console.log(`[${requestId}] ❌ Validation failed: Invalid mobile number`);
      return send(res, {
        version: "1.0.0",
        status: 400,
        action: "ValidationError",
        userMessage: "Please enter a valid mobile phone number.",
      });
    }

    // Validate membership number format if provided
    if (membershipNumber && !/^[A-Za-z0-9\-_]{3,20}$/.test(membershipNumber)) {
      console.log(`[${requestId}] ❌ Validation failed: Invalid membership number`);
      return send(res, {
        version: "1.0.0",
        status: 400,
        action: "ValidationError",
        userMessage: "Please enter a valid membership number.",
      });
    }

    // Build query to check for duplicates across email, mobile, and membership number
    const duplicateChecks = [];
    
    // Always check normalized email
    duplicateChecks.push({ normalizedEmail });
    
    // Check mobile number if provided
    if (mobileNumber) {
      duplicateChecks.push({ "contactInfo.mobileNumber": mobileNumber });
    }
    
    // Check membership number if provided
    if (membershipNumber) {
      duplicateChecks.push({ membershipNumber: membershipNumber });
    }

    // Build final query
    // IMPORTANT: Check ALL profiles (active AND inactive)
    // This prevents duplicate profiles and preserves member history
    // When an inactive member returns, they should reactivate their existing profile
    const query = {
      $or: duplicateChecks,
      // NO isActive filter - check all profiles to prevent duplicates
    };
    
    // Add tenant filter if provided
    if (tenantId) {
      query.tenantId = tenantId;
    }

    console.log(`[${requestId}] 🔍 Searching for existing profile(s) (active OR inactive)...`);
    const dbStartTime = Date.now();

    // Use find() instead of findOne() to detect multiple profiles (data integrity issue)
    const existingProfiles = await Profile.find(query)
      .maxTimeMS(3000)
      .lean()
      .exec();

    const dbDuration = Date.now() - dbStartTime;
    console.log(`[${requestId}] ⏱️  Database query time: ${dbDuration}ms`);
    console.log(`[${requestId}] 📊 Found ${existingProfiles.length} matching profile(s)`);

    // Check if profile exists (during signup step)
    const isSignupStep =
      step === "signup" || step === "PostAttributeCollection" || !step;

    if (existingProfiles.length > 0 && isSignupStep) {
      // DATA INTEGRITY CHECK: Multiple profiles found - critical issue!
      if (existingProfiles.length > 1) {
        console.error(
          `[${requestId}] ⚠️ DATA INTEGRITY ISSUE: Found ${existingProfiles.length} profiles with same email/mobile!`
        );
        console.error(
          `[${requestId}] 📋 Profile IDs:`,
          existingProfiles.map(p => p._id.toString())
        );
        
        // Log all matching profiles for investigation
        existingProfiles.forEach((profile, index) => {
          console.error(`[${requestId}] Profile ${index + 1}:`, {
            id: profile._id.toString(),
            email: profile.normalizedEmail,
            mobile: profile.contactInfo?.mobileNumber,
            membershipNumber: profile.membershipNumber,
            isActive: profile.isActive,
            tenantId: profile.tenantId?.toString(),
          });
        });

        // Block signup and alert about data issue
        const duration = Date.now() - startTime;
        console.log(`[${requestId}] ⏱️  Total response time: ${duration}ms`);
        console.log(`[${requestId}] ${"=".repeat(80)}\n`);

        return send(res, {
          version: "1.0.0",
          action: "ShowBlockPage",
          userMessage: "We found multiple records associated with this information. Please contact support to resolve this issue.",
        });
      }

      // Single profile found - proceed with normal logic
      const existingProfile = existingProfiles[0];
      
      // Determine which field(s) caused the match
      const duplicateFields = [];
      
      if (existingProfile.normalizedEmail === normalizedEmail) {
        duplicateFields.push("email address");
      }
      
      if (mobileNumber && existingProfile.contactInfo?.mobileNumber === mobileNumber) {
        duplicateFields.push("mobile phone number");
      }
      
      if (membershipNumber && existingProfile.membershipNumber === membershipNumber) {
        duplicateFields.push("membership number");
      }

      console.log(
        `[${requestId}] 📋 Existing profile found!`
      );
      console.log(`[${requestId}] 📋 Profile status: ${existingProfile.isActive ? 'ACTIVE' : 'INACTIVE'}`);
      console.log(`[${requestId}] 🔍 Matching field(s): ${duplicateFields.join(", ")}`);
      console.log(`[${requestId}] 📋 Existing profile ID: ${existingProfile._id}`);

      if (existingProfile.isActive) {
        // Scenario 2A: ACTIVE profile found (no Azure B2C account yet)
        // This is an existing member joining the portal after their membership was approved
        // ALLOW them to proceed - Azure B2C will create account and link to this profile
        console.log(
          `[${requestId}] ✅ ALLOWING: Active member joining portal (will link to existing profile)`
        );
        
        const duration = Date.now() - startTime;
        console.log(`[${requestId}] ⏱️  Total response time: ${duration}ms`);
        console.log(`[${requestId}] ${"=".repeat(80)}\n`);

        return send(res, {
          version: "1.0.0",
          action: "Continue",
          email,
          ...(tenantId && { tenantId: existingProfile.tenantId?.toString() || tenantId }),
          existingProfile: "true",  // Flag to indicate profile exists
          profileId: existingProfile._id.toString(),  // Profile to link to
          membershipNumber: existingProfile.membershipNumber,  // Return membership number
          ...(step && { step }),
          ...claims,
        });
      } else {
        // Scenario 2B: INACTIVE profile found (cancelled/resigned member returning)
        // BLOCK them and direct to support for reactivation to preserve history
        console.log(
          `[${requestId}] 🚫 BLOCKING: Inactive profile found - member needs reactivation`
        );
        
        // Create user-friendly message for inactive member
        let userMessage;
        if (duplicateFields.length === 1) {
          userMessage = `You previously had a membership with this ${duplicateFields[0]}. Please contact support to reactivate your account and preserve your membership history.`;
        } else {
          userMessage = `You previously had a membership with this ${duplicateFields.join(" and ")}. Please contact support to reactivate your account and preserve your membership history.`;
        }

        const duration = Date.now() - startTime;
        console.log(`[${requestId}] ⏱️  Total response time: ${duration}ms`);
        console.log(`[${requestId}] ${"=".repeat(80)}\n`);

        return send(res, {
          version: "1.0.0",
          action: "ShowBlockPage",
          userMessage: userMessage,
        });
      }
    }

    // No duplicate found - allow continuation
    console.log(`[${requestId}] ✅ No duplicate profile found - allowing signup`);
    
    const duration = Date.now() - startTime;
    console.log(`[${requestId}] ⏱️  Total response time: ${duration}ms`);
    console.log(`[${requestId}] ${"=".repeat(80)}\n`);

    return send(res, {
      ...CONTINUE_RESPONSE,
      email,
      ...(tenantId && { tenantId }),
      ...(step && { step }),
      ...claims,
    });
  } catch (error) {
    console.error(`[${requestId}] ❌ Profile validation error:`, error);
    console.error(`[${requestId}] Stack:`, error.stack);
    
    const duration = Date.now() - startTime;
    console.log(`[${requestId}] ⏱️  Error response time: ${duration}ms`);
    console.log(`[${requestId}] ${"=".repeat(80)}\n`);

    return send(res, {
      version: "1.0.0",
      action: "ShowBlockPage",
      userMessage: "An error occurred during validation. Please try again.",
    });
  }
};


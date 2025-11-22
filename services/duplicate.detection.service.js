const PersonalDetails = require("../models/personal.details.model.js");
const Profile = require("../models/profile.model.js");

/**
 * Normalize email for comparison
 */
function normalizeEmail(email) {
  if (!email) return null;
  return email.toLowerCase().trim();
}

/**
 * Normalize phone number for comparison (remove spaces, dashes, etc.)
 */
function normalizePhoneNumber(phone) {
  if (!phone) return null;
  return phone.replace(/[\s\-\(\)]/g, "");
}

/**
 * Normalize string for comparison (lowercase, trim)
 */
function normalizeString(str) {
  if (!str) return null;
  return str.toLowerCase().trim();
}

/**
 * Compare dates (only year, month, day)
 */
function compareDates(date1, date2) {
  if (!date1 || !date2) return false;
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/**
 * Get address line 1 (buildingOrHouse or streetOrRoad)
 */
function getAddressLine1(contactInfo) {
  if (!contactInfo) return null;
  return (
    contactInfo.buildingOrHouse ||
    contactInfo.streetOrRoad ||
    null
  );
}

/**
 * Check exact match: normalizedEmail OR mobileNumber
 */
async function checkExactMatch(applicationData, tenantId, excludeApplicationId) {
  const matches = {
    applications: [],
    profiles: [],
    matchType: null,
  };

  const normalizedEmail = normalizeEmail(
    applicationData.contactInfo?.personalEmail ||
      applicationData.contactInfo?.workEmail
  );
  const normalizedMobile = normalizePhoneNumber(
    applicationData.contactInfo?.mobileNumber
  );

  // Check exact email match
  if (normalizedEmail) {
    // Check other applications
    const emailAppMatches = await PersonalDetails.find({
      applicationId: { $ne: excludeApplicationId },
      $or: [
        { "contactInfo.personalEmail": new RegExp(`^${normalizedEmail}$`, "i") },
        { "contactInfo.workEmail": new RegExp(`^${normalizedEmail}$`, "i") },
      ],
      "meta.deleted": { $ne: true },
    }).select("applicationId");

    if (emailAppMatches.length > 0) {
      matches.applications.push(...emailAppMatches.map((a) => a.applicationId));
      matches.matchType = "exact_email";
    }

    // Check profiles
    const emailProfileMatches = await Profile.find({
      tenantId,
      normalizedEmail: normalizedEmail,
    }).select("_id");

    if (emailProfileMatches.length > 0) {
      matches.profiles.push(...emailProfileMatches.map((p) => p._id));
      if (!matches.matchType) {
        matches.matchType = "exact_email";
      }
    }
  }

  // Check exact mobile match
  if (normalizedMobile) {
    // Check other applications
    const mobileAppMatches = await PersonalDetails.find({
      applicationId: { $ne: excludeApplicationId },
      "contactInfo.mobileNumber": new RegExp(
        normalizedMobile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      ),
      "meta.deleted": { $ne: true },
    }).select("applicationId");

    if (mobileAppMatches.length > 0) {
      matches.applications.push(...mobileAppMatches.map((a) => a.applicationId));
      if (!matches.matchType) {
        matches.matchType = "exact_mobile";
      }
    }

    // Check profiles
    const mobileProfileMatches = await Profile.find({
      tenantId,
      "contactInfo.mobileNumber": new RegExp(
        normalizedMobile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      ),
    }).select("_id");

    if (mobileProfileMatches.length > 0) {
      matches.profiles.push(...mobileProfileMatches.map((p) => p._id));
      if (!matches.matchType) {
        matches.matchType = "exact_mobile";
      }
    }
  }

  return matches;
}

/**
 * Check fuzzy match: 3 out of 4 of (forename, surname, dateOfBirth, address line 1)
 */
async function checkFuzzyMatch(applicationData, tenantId, excludeApplicationId) {
  const matches = {
    applications: [],
    profiles: [],
    matchType: null,
  };

  const forename = normalizeString(applicationData.personalInfo?.forename);
  const surname = normalizeString(applicationData.personalInfo?.surname);
  const dateOfBirth = applicationData.personalInfo?.dateOfBirth;
  const addressLine1 = normalizeString(getAddressLine1(applicationData.contactInfo));

  // Need at least 3 fields to do fuzzy matching
  const fieldCount = [forename, surname, dateOfBirth, addressLine1].filter(
    (f) => f !== null && f !== undefined
  ).length;

  if (fieldCount < 3) {
    return matches; // Not enough data for fuzzy matching
  }

  // Build query to find potential matches (we'll filter to 3/4 later)
  // Include all fields that might match to reduce false negatives
  const matchConditions = [];

  if (forename) {
    matchConditions.push({
      "personalInfo.forename": new RegExp(`^${forename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    });
  }

  if (surname) {
    matchConditions.push({
      "personalInfo.surname": new RegExp(`^${surname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    });
  }

  if (dateOfBirth) {
    // Match date of birth (year, month, day)
    const dob = new Date(dateOfBirth);
    const startOfDay = new Date(dob.getFullYear(), dob.getMonth(), dob.getDate());
    const endOfDay = new Date(dob.getFullYear(), dob.getMonth(), dob.getDate() + 1);
    matchConditions.push({
      "personalInfo.dateOfBirth": {
        $gte: startOfDay,
        $lt: endOfDay,
      },
    });
  }

  if (addressLine1) {
    matchConditions.push({
      $or: [
        { "contactInfo.buildingOrHouse": new RegExp(`^${addressLine1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
        { "contactInfo.streetOrRoad": new RegExp(`^${addressLine1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      ],
    });
  }

  // Need at least one condition to query
  if (matchConditions.length === 0) {
    return matches;
  }

  // Check applications - use $or to find any potential matches, then filter
  const applicationMatches = await PersonalDetails.find({
    applicationId: { $ne: excludeApplicationId },
    $or: matchConditions, // Use $or to find any field matches
    "meta.deleted": { $ne: true },
  }).select("applicationId personalInfo contactInfo");

  // Filter applications that match 3 out of 4 fields
  const filteredApplications = applicationMatches.filter((app) => {
    let matchCount = 0;

    if (forename && normalizeString(app.personalInfo?.forename) === forename) {
      matchCount++;
    }
    if (surname && normalizeString(app.personalInfo?.surname) === surname) {
      matchCount++;
    }
    if (dateOfBirth && compareDates(app.personalInfo?.dateOfBirth, dateOfBirth)) {
      matchCount++;
    }
    if (
      addressLine1 &&
      normalizeString(getAddressLine1(app.contactInfo)) === addressLine1
    ) {
      matchCount++;
    }

    return matchCount >= 3;
  });

  if (filteredApplications.length > 0) {
    matches.applications.push(
      ...filteredApplications.map((a) => a.applicationId)
    );
    matches.matchType = "fuzzy_3of4";
  }

  // Check profiles - use same logic
  const profileMatchConditions = [];

  if (forename) {
    profileMatchConditions.push({
      "personalInfo.forename": new RegExp(`^${forename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    });
  }

  if (surname) {
    profileMatchConditions.push({
      "personalInfo.surname": new RegExp(`^${surname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    });
  }

  if (dateOfBirth) {
    const dob = new Date(dateOfBirth);
    const startOfDay = new Date(dob.getFullYear(), dob.getMonth(), dob.getDate());
    const endOfDay = new Date(dob.getFullYear(), dob.getMonth(), dob.getDate() + 1);
    profileMatchConditions.push({
      "personalInfo.dateOfBirth": {
        $gte: startOfDay,
        $lt: endOfDay,
      },
    });
  }

  if (addressLine1) {
    profileMatchConditions.push({
      $or: [
        { "contactInfo.buildingOrHouse": new RegExp(`^${addressLine1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
        { "contactInfo.streetOrRoad": new RegExp(`^${addressLine1.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      ],
    });
  }

  if (profileMatchConditions.length === 0) {
    return matches;
  }

  const profileMatches = await Profile.find({
    tenantId,
    $or: profileMatchConditions, // Use $or to find any field matches
  }).select("_id personalInfo contactInfo");

  // Filter profiles that match 3 out of 4 fields
  const filteredProfiles = profileMatches.filter((profile) => {
    let matchCount = 0;

    if (
      forename &&
      normalizeString(profile.personalInfo?.forename) === forename
    ) {
      matchCount++;
    }
    if (
      surname &&
      normalizeString(profile.personalInfo?.surname) === surname
    ) {
      matchCount++;
    }
    if (
      dateOfBirth &&
      compareDates(profile.personalInfo?.dateOfBirth, dateOfBirth)
    ) {
      matchCount++;
    }
    if (
      addressLine1 &&
      normalizeString(getAddressLine1(profile.contactInfo)) === addressLine1
    ) {
      matchCount++;
    }

    return matchCount >= 3;
  });

  if (filteredProfiles.length > 0) {
    matches.profiles.push(...filteredProfiles.map((p) => p._id));
    if (!matches.matchType) {
      matches.matchType = "fuzzy_3of4";
    }
  }

  return matches;
}

/**
 * Detect duplicates for an application
 * Runs in background - doesn't block the main flow
 */
async function detectDuplicates(applicationId, tenantId) {
  try {
    console.log(
      "🔍 [DUPLICATE_DETECTION] Starting duplicate detection:",
      {
        applicationId,
        tenantId,
      }
    );

    // Get the application data
    const application = await PersonalDetails.findOne({
      applicationId,
    });

    if (!application) {
      console.warn(
        "⚠️ [DUPLICATE_DETECTION] Application not found:",
        applicationId
      );
      return;
    }

    // Check for exact matches first
    const exactMatches = await checkExactMatch(
      {
        personalInfo: application.personalInfo,
        contactInfo: application.contactInfo,
      },
      tenantId,
      applicationId
    );

    let isDuplicate = false;
    let matchType = null;
    let matchedApplicationIds = [];
    let matchedProfileIds = [];

    if (
      exactMatches.applications.length > 0 ||
      exactMatches.profiles.length > 0
    ) {
      isDuplicate = true;
      matchType = exactMatches.matchType;
      matchedApplicationIds = exactMatches.applications;
      matchedProfileIds = exactMatches.profiles;
    } else {
      // If no exact match, check fuzzy match
      const fuzzyMatches = await checkFuzzyMatch(
        {
          personalInfo: application.personalInfo,
          contactInfo: application.contactInfo,
        },
        tenantId,
        applicationId
      );

      if (
        fuzzyMatches.applications.length > 0 ||
        fuzzyMatches.profiles.length > 0
      ) {
        isDuplicate = true;
        matchType = fuzzyMatches.matchType;
        matchedApplicationIds = fuzzyMatches.applications;
        matchedProfileIds = fuzzyMatches.profiles;
      }
    }

    // Update application with duplicate detection results
    await PersonalDetails.updateOne(
      { applicationId },
      {
        $set: {
          "duplicateDetection.isPotentialDuplicate": isDuplicate,
          "duplicateDetection.detectedAt": new Date(),
          "duplicateDetection.matchType": matchType,
          "duplicateDetection.matchedApplicationIds": matchedApplicationIds,
          "duplicateDetection.matchedProfileIds": matchedProfileIds,
        },
      }
    );

    console.log(
      isDuplicate
        ? "⚠️ [DUPLICATE_DETECTION] Potential duplicate detected:"
        : "✅ [DUPLICATE_DETECTION] No duplicates found:",
      {
        applicationId,
        isDuplicate,
        matchType,
        matchedApplications: matchedApplicationIds.length,
        matchedProfiles: matchedProfileIds.length,
      }
    );
  } catch (error) {
    console.error(
      "❌ [DUPLICATE_DETECTION] Error detecting duplicates:",
      {
        error: error.message,
        applicationId,
        stack: error.stack,
      }
    );
    // Don't throw - duplicate detection failure shouldn't block the application flow
  }
}

module.exports = {
  detectDuplicates,
  checkExactMatch,
  checkFuzzyMatch,
};


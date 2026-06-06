const PersonalDetails = require("../models/personal.details.model.js");
const ProfessionalDetails = require("../models/professional.details.model.js");
const SubscriptionDetails = require("../models/subscription.model.js");
const Profile = require("../models/profile.model.js");
const { APPLICATION_STATUS, DUPLICATE_REVIEW_STATUS } = require("../constants/enums.js");
const {
  normalizeEmail,
  normalizePhoneNumber,
  normalizeIdentifier,
  buildMatchableRecord,
  scorePair,
  toMatchSummaryEntry,
} = require("./duplicate.matching.js");

const NON_APPROVED_STATUSES = [
  APPLICATION_STATUS.IN_PROGRESS,
  APPLICATION_STATUS.SUBMITTED,
];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function loadApplicationBundle(applicationId) {
  const [personal, professional, subscription] = await Promise.all([
    PersonalDetails.findOne({ applicationId }).lean(),
    ProfessionalDetails.findOne({ applicationId }).lean(),
    SubscriptionDetails.findOne({ applicationId }).lean(),
  ]);

  if (!personal) return null;

  return {
    personal,
    professional: professional?.professionalDetails || {},
    subscription: subscription?.subscriptionDetails || {},
  };
}

function bundleToRecord(bundle) {
  return buildMatchableRecord({
    personalInfo: bundle.personal.personalInfo,
    contactInfo: bundle.personal.contactInfo,
    professionalDetails: bundle.professional,
    subscriptionDetails: bundle.subscription,
    applicationId: bundle.personal.applicationId,
  });
}

function profileToRecord(profile) {
  return buildMatchableRecord({
    personalInfo: profile.personalInfo,
    contactInfo: profile.contactInfo,
    professionalDetails: profile.professionalDetails,
    subscriptionDetails: {
      payrollNo: profile.professionalDetails?.payrollNo,
    },
    profileId: profile._id,
    membershipNumber: profile.membershipNumber,
  });
}

async function filterNonApprovedApplicationIds(applicationIds) {
  if (!applicationIds.length) return [];
  const rows = await PersonalDetails.find({
    applicationId: { $in: applicationIds },
    applicationStatus: { $in: NON_APPROVED_STATUSES },
    "meta.deleted": { $ne: true },
  })
    .select("applicationId")
    .lean();
  return rows.map((row) => row.applicationId);
}

async function findExactApplicationCandidates(source, excludeApplicationId) {
  const ids = new Set();
  const orConditions = [];

  if (source.email) {
    orConditions.push(
      { "contactInfo.personalEmail": new RegExp(`^${escapeRegex(source.email)}$`, "i") },
      { "contactInfo.workEmail": new RegExp(`^${escapeRegex(source.email)}$`, "i") },
    );
  }
  if (source.mobile) {
    orConditions.push({
      "contactInfo.mobileNumber": new RegExp(escapeRegex(source.mobile), "i"),
    });
  }

  if (orConditions.length > 0) {
    const emailMobileMatches = await PersonalDetails.find({
      applicationId: { $ne: excludeApplicationId },
      applicationStatus: { $in: NON_APPROVED_STATUSES },
      "meta.deleted": { $ne: true },
      $or: orConditions,
    })
      .select("applicationId")
      .lean();
    emailMobileMatches.forEach((row) => ids.add(row.applicationId));
  }

  if (source.nmbiNumber) {
    const nmbiMatches = await ProfessionalDetails.find({
      applicationId: { $ne: excludeApplicationId },
      "professionalDetails.nmbiNumber": new RegExp(
        `^${escapeRegex(source.nmbiNumber)}$`,
        "i",
      ),
    })
      .select("applicationId")
      .lean();
    nmbiMatches.forEach((row) => ids.add(row.applicationId));
  }

  if (source.payrollNo) {
    const payrollMatches = await SubscriptionDetails.find({
      applicationId: { $ne: excludeApplicationId },
      "subscriptionDetails.payrollNo": new RegExp(
        `^${escapeRegex(source.payrollNo)}$`,
        "i",
      ),
    })
      .select("applicationId")
      .lean();
    payrollMatches.forEach((row) => ids.add(row.applicationId));
  }

  if (source.previousMembershipNo) {
    const prevMatches = await SubscriptionDetails.find({
      applicationId: { $ne: excludeApplicationId },
      "subscriptionDetails.previousMembershipNo": new RegExp(
        `^${escapeRegex(source.previousMembershipNo)}$`,
        "i",
      ),
    })
      .select("applicationId")
      .lean();
    prevMatches.forEach((row) => ids.add(row.applicationId));
  }

  return filterNonApprovedApplicationIds([...ids]);
}

async function findFuzzyApplicationCandidates(source, excludeApplicationId) {
  const conditions = [];

  if (source.surname) {
    conditions.push({
      "personalInfo.surname": new RegExp(`^${escapeRegex(source.surname)}$`, "i"),
    });
  }
  if (source.forename) {
    conditions.push({
      "personalInfo.forename": new RegExp(`^${escapeRegex(source.forename)}$`, "i"),
    });
  }
  if (source.eircode) {
    conditions.push({
      "contactInfo.eircode": new RegExp(`^${escapeRegex(source.eircode)}$`, "i"),
    });
  }
  if (source.addressLine1) {
    conditions.push(
      {
        "contactInfo.buildingOrHouse": new RegExp(
          `^${escapeRegex(source.addressLine1)}$`,
          "i",
        ),
      },
      {
        "contactInfo.streetOrRoad": new RegExp(
          `^${escapeRegex(source.addressLine1)}$`,
          "i",
        ),
      },
    );
  }
  if (source.dateOfBirth) {
    const dob = new Date(source.dateOfBirth);
    const startOfDay = new Date(dob.getFullYear(), dob.getMonth(), dob.getDate());
    const endOfDay = new Date(dob.getFullYear(), dob.getMonth(), dob.getDate() + 1);
    conditions.push({
      "personalInfo.dateOfBirth": { $gte: startOfDay, $lt: endOfDay },
    });
  }

  if (conditions.length === 0) return [];

  const rows = await PersonalDetails.find({
    applicationId: { $ne: excludeApplicationId },
    applicationStatus: { $in: NON_APPROVED_STATUSES },
    "meta.deleted": { $ne: true },
    $or: conditions,
  })
    .select("applicationId")
    .lean();

  return rows.map((row) => row.applicationId);
}

async function findExactProfileCandidates(source, tenantId) {
  const ids = new Set();

  if (source.email) {
    const emailMatches = await Profile.find({
      tenantId,
      normalizedEmail: source.email,
    })
      .select("_id")
      .lean();
    emailMatches.forEach((row) => ids.add(String(row._id)));
  }

  if (source.mobile) {
    const mobileMatches = await Profile.find({
      tenantId,
      "contactInfo.mobileNumber": new RegExp(escapeRegex(source.mobile), "i"),
    })
      .select("_id")
      .lean();
    mobileMatches.forEach((row) => ids.add(String(row._id)));
  }

  if (source.nmbiNumber) {
    const nmbiMatches = await Profile.find({
      tenantId,
      "professionalDetails.nmbiNumber": new RegExp(
        `^${escapeRegex(source.nmbiNumber)}$`,
        "i",
      ),
    })
      .select("_id")
      .lean();
    nmbiMatches.forEach((row) => ids.add(String(row._id)));
  }

  if (source.payrollNo) {
    const payrollMatches = await Profile.find({
      tenantId,
      "professionalDetails.payrollNo": new RegExp(
        `^${escapeRegex(source.payrollNo)}$`,
        "i",
      ),
    })
      .select("_id")
      .lean();
    payrollMatches.forEach((row) => ids.add(String(row._id)));
  }

  if (source.previousMembershipNo) {
    const membershipMatches = await Profile.find({
      tenantId,
      membershipNumber: new RegExp(
        `^${escapeRegex(source.previousMembershipNo)}$`,
        "i",
      ),
    })
      .select("_id")
      .lean();
    membershipMatches.forEach((row) => ids.add(String(row._id)));
  }

  return [...ids];
}

async function findFuzzyProfileCandidates(source, tenantId) {
  const conditions = [];

  if (source.surname) {
    conditions.push({
      "personalInfo.surname": new RegExp(`^${escapeRegex(source.surname)}$`, "i"),
    });
  }
  if (source.forename) {
    conditions.push({
      "personalInfo.forename": new RegExp(`^${escapeRegex(source.forename)}$`, "i"),
    });
  }
  if (source.eircode) {
    conditions.push({
      "contactInfo.eircode": new RegExp(`^${escapeRegex(source.eircode)}$`, "i"),
    });
  }
  if (source.addressLine1) {
    conditions.push(
      {
        "contactInfo.buildingOrHouse": new RegExp(
          `^${escapeRegex(source.addressLine1)}$`,
          "i",
        ),
      },
      {
        "contactInfo.streetOrRoad": new RegExp(
          `^${escapeRegex(source.addressLine1)}$`,
          "i",
        ),
      },
    );
  }
  if (source.dateOfBirth) {
    const dob = new Date(source.dateOfBirth);
    const startOfDay = new Date(dob.getFullYear(), dob.getMonth(), dob.getDate());
    const endOfDay = new Date(dob.getFullYear(), dob.getMonth(), dob.getDate() + 1);
    conditions.push({
      "personalInfo.dateOfBirth": { $gte: startOfDay, $lt: endOfDay },
    });
  }

  if (conditions.length === 0) return [];

  const rows = await Profile.find({ tenantId, $or: conditions })
    .select("_id")
    .lean();
  return rows.map((row) => String(row._id));
}

async function scoreApplicationCandidates(source, applicationIds) {
  const matches = [];
  for (const applicationId of applicationIds) {
    const bundle = await loadApplicationBundle(applicationId);
    if (!bundle) continue;
    const record = bundleToRecord(bundle);
    const result = scorePair(source, record);
    if (!result) continue;
    matches.push(toMatchSummaryEntry("APPLICATION", record, result));
  }
  return matches;
}

async function scoreProfileCandidates(source, profileIds) {
  const matches = [];
  for (const profileId of profileIds) {
    const profile = await Profile.findById(profileId).lean();
    if (!profile) continue;
    const record = profileToRecord(profile);
    const result = scorePair(source, record);
    if (!result) continue;
    matches.push(toMatchSummaryEntry("PROFILE", record, result));
  }
  return matches;
}

async function findDuplicateMatches(applicationId, tenantId) {
  const bundle = await loadApplicationBundle(applicationId);
  if (!bundle) {
    return {
      matchingApplications: [],
      matchingProfiles: [],
      matchSummary: [],
      hasPotentialDuplicate: false,
    };
  }

  const source = bundleToRecord(bundle);

  const applicationCandidateIds = new Set([
    ...(await findExactApplicationCandidates(source, applicationId)),
    ...(await findFuzzyApplicationCandidates(source, applicationId)),
  ]);

  const profileCandidateIds = new Set([
    ...(await findExactProfileCandidates(source, tenantId)),
    ...(await findFuzzyProfileCandidates(source, tenantId)),
  ]);

  const [applicationMatches, profileMatches] = await Promise.all([
    scoreApplicationCandidates(source, [...applicationCandidateIds]),
    scoreProfileCandidates(source, [...profileCandidateIds]),
  ]);

  const matchSummary = [...applicationMatches, ...profileMatches].sort(
    (a, b) => b.score - a.score,
  );

  return {
    matchingApplications: applicationMatches,
    matchingProfiles: profileMatches,
    matchSummary,
    hasPotentialDuplicate: matchSummary.some((m) => !m.ignored && m.score >= 40),
  };
}

async function detectDuplicates(applicationId, tenantId) {
  try {
    const result = await findDuplicateMatches(applicationId, tenantId);
    const activeMatches = result.matchSummary.filter((m) => !m.ignored);
    const isDuplicate = activeMatches.length > 0;
    const topMatch = activeMatches[0] || null;

    const reviewStatus = isDuplicate
      ? DUPLICATE_REVIEW_STATUS.POTENTIAL_MATCH
      : DUPLICATE_REVIEW_STATUS.NO_MATCH;

    await PersonalDetails.updateOne(
      { applicationId },
      {
        $set: {
          "duplicateDetection.isPotentialDuplicate": isDuplicate,
          "duplicateDetection.detectedAt": new Date(),
          "duplicateDetection.matchType": topMatch?.score === 100
            ? "exact"
            : topMatch
              ? "fuzzy_scored"
              : null,
          "duplicateDetection.matchedApplicationIds": result.matchingApplications.map(
            (m) => m.sourceId,
          ),
          "duplicateDetection.matchedProfileIds": result.matchingProfiles.map(
            (m) => m.sourceId,
          ),
          "duplicateReview.status": reviewStatus,
          "duplicateReview.matchSummary": result.matchSummary,
          "duplicateReview.detectedAt": new Date(),
        },
      },
    );

    return result;
  } catch (error) {
    console.error("❌ [DUPLICATE_DETECTION] Error:", {
      error: error.message,
      applicationId,
    });
    throw error;
  }
}

module.exports = {
  detectDuplicates,
  findDuplicateMatches,
  loadApplicationBundle,
  bundleToRecord,
  profileToRecord,
  normalizeEmail,
  normalizePhoneNumber,
  normalizeIdentifier,
};

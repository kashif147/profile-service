const Profile = require("../models/profile.model.js");
const { AppError } = require("../errors/AppError");
const axios = require("axios");


async function getCornMarketProfiles(req, res, next) {
  try {
    // Only CRM users are allowed to access this endpoint
    if (req.user?.userType !== "CRM") {
      return next(AppError.badRequest("Only CRM users can access this endpoint"));
    }

    const membershipStatus = req.query.membershipStatus;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    // Validate membershipStatus parameter
    if (!membershipStatus) {
      return next(
        AppError.badRequest("membershipStatus query parameter is required")
      );
    }

    // Normalize membershipStatus to lowercase for simple matching
    const normalizedStatus = membershipStatus.toLowerCase().trim();

    // Validate that membershipStatus is either "new" or "graduate"
    // Database stores "new" or "graduate" directly
    if (normalizedStatus !== "new" && normalizedStatus !== "graduate") {
      return next(
        AppError.badRequest(
          'membershipStatus must be either "new" or "graduate"'
        )
      );
    }

    // Build query: membershipStatus matches AND valueAddedServices is true
    const query = {
      "additionalInformation.membershipStatus": normalizedStatus, // Direct match - DB stores "new" or "graduate"
      "preferences.valueAddedServices": true, // Must be true
    };

    const [profiles, total] = await Promise.all([
      Profile.find(query).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
      Profile.countDocuments(query),
    ]);

    // Fetch current subscription startDate for these profiles from subscription service
    let subscriptionStartMap = new Map();
    if (profiles.length > 0) {
      const subscriptionServiceUrl =
        process.env.SUBSCRIPTION_SERVICE_URL || "https://subscriptionserviceshell-ambyf5dsa8c9dhcg.northeurope-01.azurewebsites.net";
      const profileIds = profiles.map((p) => p._id.toString());

      // Fetch subscriptions for all profiles in parallel
      const subscriptionPromises = profileIds.map(async (profileId) => {
        try {
          const response = await axios.get(
            `${subscriptionServiceUrl}/api/v1/subscriptions/profile/${profileId}/current`,
            {
              timeout: 10000, // 10 second timeout
              validateStatus: (status) => status < 500, // Don't throw on 4xx
              headers: {
                Authorization: req.headers.authorization || "", // Forward auth token
              },
            }
          );

          if (response.status === 200 && response.data?.data?.startDate) {
            return {
              profileId,
              startDate: response.data.data.startDate,
            };
          }
          return null;
        } catch (error) {
          // Log error but don't fail the entire request
          console.warn(
            `Failed to fetch subscription for profile ${profileId}:`,
            error.message
          );
          return null;
        }
      });

      const subscriptionResults = await Promise.all(subscriptionPromises);
      subscriptionStartMap = new Map(
        subscriptionResults
          .filter(Boolean)
          .map((s) => [s.profileId, s.startDate])
      );
    }

    // Field selectors for different membership statuses
    const formatForNew = (p) => {
      const contact = p.contactInfo || {};
      const personal = p.personalInfo || {};
      const cornMarket = p.cornMarket || {};
      
      // Build full name from forename and surname
      const fullName = [personal.forename, personal.surname]
        .filter(Boolean)
        .join(" ") || null;

      return {
        membershipNo: p.membershipNumber || null,
        fullName: fullName,
        addressLine1: contact.buildingOrHouse || null,
        addressLine2: contact.streetOrRoad || null,
        addressLine3: contact.areaOrTown || null,
        addressCity: contact.areaOrTown || null, // Using areaOrTown for city
        addressCounty: contact.countyCityOrPostCode || null,
        addressPostcode: contact.eircode || null,
        email: contact.personalEmail || contact.workEmail || null,
        mobileNumber: contact.mobileNumber || null,
        dateOfBirth: personal.dateOfBirth || null,
        joinDate: subscriptionStartMap.get(p._id.toString()) || null, // From subscription service
        newMember: normalizedStatus === "new",
        reward: cornMarket.inmoRewards || false,
      };
    };

    const formatForNewGraduate = (p) => {
      const contact = p.contactInfo || {};
      const personal = p.personalInfo || {};
      const professional = p.professionalDetails || {};
      const cornMarket = p.cornMarket || {};

      return {
        membershipNumber: p.membershipNumber || null,
        dateJoined: p.firstJoinedDate || null,
        dateApplicationProcessed: p.submissionDate || null,
        unionConsent: p.preferences?.valueAddedServices || false,
        exclusiveDiscountsAndOffers: cornMarket.exclusiveDiscountsAndOffers || false,
        cornmarketMarketingOptIn: cornMarket.incomeProtectionScheme || false,
        dateOfBirth: personal.dateOfBirth || null,
        workplace: professional.workLocation || null,
        payrollNumber: professional.payrollNo || null,
        grade: professional.grade || null,
        gender: personal.gender || null,
        surname: personal.surname || null,
        forenames: personal.forename || null,
        telephoneMobile: contact.mobileNumber || null,
        emailAddress: contact.personalEmail || contact.workEmail || null,
        address: contact.buildingOrHouse || null,
        addr2: contact.streetOrRoad || null,
        addr3: contact.areaOrTown || null,
        addr4: contact.countyCityOrPostCode || null,
        eircode: contact.eircode || null,
        joinDate:
          subscriptionStartMap.get(p._id.toString()) || null,
      };
    };

    const formatter =
      normalizedStatus === "graduate"
        ? formatForNewGraduate
        : formatForNew;

    const resultsWithStartDate = profiles.map((p) => formatter(p));

    return res.success({
      count: resultsWithStartDate.length,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      membershipStatus: normalizedStatus, // Return what CRM sent
      results: resultsWithStartDate,
    });
  } catch (error) {
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch CORN market profiles"
      )
    );
  }
}

module.exports = {
  getCornMarketProfiles,
};

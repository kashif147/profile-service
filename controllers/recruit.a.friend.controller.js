const Profile = require("../models/profile.model.js");
const { AppError } = require("../errors/AppError");


async function getRecruitAFriendProfiles(req, res, next) {
  try {
  
    if (req.user?.userType !== "CRM") {
      return next(
        AppError.badRequest("Only CRM users can access this endpoint")
      );
    }

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

  
    const query = {
      "recruitmentDetails.confirmedRecruiterProfileId": { $ne: null },
    };

    const [profiles, total] = await Promise.all([
      Profile.find(query)
        .skip(skip)
        .limit(limit)
        .lean(),
      Profile.countDocuments(query),
    ]);

    return res.success({
      count: profiles.length,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      results: profiles,
    });
  } catch (error) {
    return next(
      AppError.internalServerError(
        error.message || "Failed to fetch Recruit a Friend profiles"
      )
    );
  }
}

module.exports = {
  getRecruitAFriendProfiles,
};

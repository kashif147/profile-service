function extractUserAndCreatorContext(req) {
  const userType = req.user?.userType;
  const creatorId = req.user?.id || req.user?._id;

  let userId = null;

  if (userType === "PORTAL") {
    userId = creatorId;
  } else if (userType === "CRM") {
    userId = null;
  }

  return {
    userType,
    userId,
    creatorId,
  };
}

module.exports = { extractUserAndCreatorContext };

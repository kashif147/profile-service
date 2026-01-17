function extractUserAndCreatorContext(req) {
  const userType = req.user?.userType;
  const creatorId = req.user?.id || req.user?._id;
  const tenantId = req.tenantId || req.user?.tenantId;

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
    tenantId,
  };
}

module.exports = { extractUserAndCreatorContext };

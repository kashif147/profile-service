// Membership Events that this service publishes
const MEMBERSHIP_EVENTS = {
  MEMBER_CREATED_REQUESTED: "members.member.created.requested.v1",
	SUBSCRIPTION_UPSERT_REQUESTED: "members.subscription.upsert.requested.v1",
  // New event: fired when a member's work location/branch/region changes
  PROFESSIONAL_WORK_LOCATION_UPDATED:
    "members.professionaldetails.worklocation.updated.v1",
};

module.exports = {
  MEMBERSHIP_EVENTS,
};

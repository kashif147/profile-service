const express = require("express");
const router = express.Router();
const profileValidationController = require("../controllers/profile.validation.controller.js");
const profileController = require("../controllers/profile.controller.js");
const {
  detectProfileDuplicatesHandler,
  getProfileDuplicateMatches,
  getProfileDuplicateMergeCompareHandler,
  submitProfileDuplicateMerge,
} = require("../controllers/profile.duplicateReview.controller.js");
const aggregatedUserDetailsController = require("../controllers/aggregated.user.details.controller.js");
const { authenticate, tenantContextWarn } = require("../middlewares/auth");
const {
  requireCrm,
  crmOrOwnProfileParam,
  crmOrSelfLookup,
  internalOrCrmOrSelfLookup,
  requestedProfileIds,
  verifiedCallerId,
} = require("../middlewares/memberAccess");
// P5 prerequisite (blocker 1): explicit local guards after the PDP check; see middlewares/p5ActionGuards.js.
const { requireTenantAdmin } = require("../middlewares/p5ActionGuards");

// P5 portal object authorization: CRM staff need the profile permission; a portal caller may only
// look up its own profile / user id / membership number (see middlewares/memberAccess.js).
const selfProfileIdLookup = {
  requestedKeysOf: requestedProfileIds,
  ownKeysOf: (own) => [own && own._id],
};
const selfUserIdLookup = {
  requestedKeysOf: (req) => (Array.isArray(req.body && req.body.userIds) ? req.body.userIds : []),
  ownKeysOf: (_own, req) => [verifiedCallerId(req)],
};
const selfMembershipLookup = {
  requestedKeysOf: (req) =>
    Array.isArray(req.body && req.body.membershipNumbers) ? req.body.membershipNumbers : [],
  ownKeysOf: (own) => [own && own.membershipNumber],
};

router.post("/validate", profileValidationController.validateProfile);

// Internal endpoints for service-to-service calls (before authenticate)
router.get("/internal/by-email", profileController.getProfileByEmailInternal);
router.post(
  "/internal/by-user-ids",
  internalOrCrmOrSelfLookup("profile", "read", selfUserIdLookup),
  profileController.getProfilesByUserIds,
);
router.post(
  "/internal/find-or-create-attendee",
  profileController.findOrCreateAttendeeProfile,
);
router.post(
  "/internal/attendee-duplicate-check",
  profileController.checkAttendeeDuplicates,
);
router.post(
  "/internal/rollback-attendee-profile",
  profileController.rollbackAttendeeProfile,
);
router.post(
  "/internal/attendee-profile-fields-sync",
  profileController.syncAttendeeProfileFields,
);
router.post(
  "/internal/attendee-profile-fields-update",
  profileController.updateAttendeeProfileFields,
);

const batchAccess = internalOrCrmOrSelfLookup("profile", "read", selfProfileIdLookup);
router.post("/batch", batchAccess, profileController.getProfilesBatch);
router.get("/batch", batchAccess, profileController.getProfilesBatch);

router.use(authenticate, tenantContextWarn);

// Literal paths first so they are not matched by /:profileId (which would return "Invalid profileId")
router.get(
  "/aggregated-user-details",
  aggregatedUserDetailsController.getAggregatedUserDetails,
);
router.get("/check-email", requireCrm("profile", "read"), profileController.checkEmailExists);
router.get("/", requireCrm("profile", "read"), profileController.getAllProfiles);
router.get("/search", requireCrm("profile", "read"), profileController.searchProfiles);
router.post(
  "/lookup-by-membership",
  crmOrSelfLookup("profile", "read", selfMembershipLookup),
  profileController.lookupProfilesByMembershipNumbers,
);
router.post(
  "/batch-lookup",
  crmOrSelfLookup("profile", "read", selfProfileIdLookup),
  profileController.getProfilesBatchAuthenticated,
);
router.get("/my-profile", profileController.getMyProfile);
router.put("/my-profile", profileController.updateMyProfile);
router.get("/my-personal-details", profileController.getMyPersonalDetails);
router.get(
  "/my-professional-details",
  profileController.getMyProfessionalDetails,
);
router.get(
  "/my-subscription-details",
  profileController.getMySubscriptionDetails,
);
router.get("/my-details", profileController.getMyAllDetails);
router.put(
  "/filter",
  requireCrm("profile", "read"),
  profileController.getProfilesWithTemplate,
);
router.get("/corn-market/new", requireCrm("profile", "read"), profileController.getCornMarketNew);
router.get(
  "/corn-market/graduate",
  requireCrm("profile", "read"),
  profileController.getCornMarketGraduate,
);

// Duplicate review / merge is administrative: CRM + permission, never portal. The merge
// deactivates a profile and moves its data, so it needs the delete permission.
router.post(
  "/:profileId/detect-duplicates",
  requireCrm("profile", "write"),
  detectProfileDuplicatesHandler,
);
router.get(
  "/:profileId/duplicate-matches",
  requireCrm("profile", "read"),
  getProfileDuplicateMatches,
);
router.get(
  "/:profileId/duplicate-merge-compare/:targetProfileId",
  requireCrm("profile", "read"),
  getProfileDuplicateMergeCompareHandler,
);
// Duplicate merge (owner decision 2026-11-08): tenant administrator (ASU) ONLY, decided before any handler code -
// so before any profile write and before the subscription-service / account-service reassignments. Order: the
// PDP check (profile:write) first, then requireTenantAdmin, a local check of the verified "*" claim that does not
// depend on the PDP or on PDP_AUDIENCE_MODE: a non-ASU caller is refused under today's category rule (PDP) AND
// under P5 audience enforcement (the local guard). This is the ONLY route that performs a merge. MO merge access
// returns only after the downstream merge steps become signed, tenant- and pair-bound service commands.
router.post(
  "/:profileId/duplicate-merge",
  requireCrm("profile", "write"),
  requireTenantAdmin,
  submitProfileDuplicateMerge,
);

// Portal: own profile only (field scope still enforced by the controller). Portal profile
// deletion is not a product flow: DELETE is CRM-only.
router.get("/:profileId", crmOrOwnProfileParam("profile", "read"), profileController.getProfileById);
router.put("/:profileId", crmOrOwnProfileParam("profile", "write"), profileController.updateProfile);
router.delete("/:profileId", requireCrm("profile", "delete"), requireTenantAdmin, profileController.softDeleteProfile);

module.exports = router;

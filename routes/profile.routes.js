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
const { authenticate } = require("../middlewares/auth");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");

router.post("/validate", profileValidationController.validateProfile);

// Internal endpoints for service-to-service calls (before authenticate)
router.get("/internal/by-email", profileController.getProfileByEmailInternal);
router.post("/internal/by-user-ids", profileController.getProfilesByUserIds);

router.post("/batch", profileController.getProfilesBatch);
router.get("/batch", profileController.getProfilesBatch);

router.use(authenticate);

// Literal paths first so they are not matched by /:profileId (which would return "Invalid profileId")
router.get(
  "/aggregated-user-details",
  aggregatedUserDetailsController.getAggregatedUserDetails,
);
router.get("/check-email", profileController.checkEmailExists);
router.get("/", profileController.getAllProfiles);
router.get("/search", profileController.searchProfiles);
router.post(
  "/lookup-by-membership",
  profileController.lookupProfilesByMembershipNumbers,
);
router.post("/batch-lookup", profileController.getProfilesBatchAuthenticated);
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
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  profileController.getProfilesWithTemplate,
);
router.get("/corn-market/new", profileController.getCornMarketNew);
router.get("/corn-market/graduate", profileController.getCornMarketGraduate);

router.post(
  "/:profileId/detect-duplicates",
  detectProfileDuplicatesHandler,
);
router.get(
  "/:profileId/duplicate-matches",
  getProfileDuplicateMatches,
);
router.get(
  "/:profileId/duplicate-merge-compare/:targetProfileId",
  getProfileDuplicateMergeCompareHandler,
);
router.post(
  "/:profileId/duplicate-merge",
  submitProfileDuplicateMerge,
);

router.get("/:profileId", profileController.getProfileById);
router.put("/:profileId", profileController.updateProfile);
router.delete("/:profileId", profileController.softDeleteProfile);

module.exports = router;

const express = require("express");
const router = express.Router();
const profileValidationController = require("../controllers/profile.validation.controller.js");
const profileController = require("../controllers/profile.controller.js");
const aggregatedUserDetailsController = require("../controllers/aggregated.user.details.controller.js");
const { authenticate } = require("../middlewares/auth");

router.post("/validate", profileValidationController.validateProfile);

// Internal endpoint for service-to-service calls (before authenticate to allow internal header bypass)
// Accepts JWT token OR internal header
router.post("/internal/by-user-ids", profileController.getProfilesByUserIds);

router.post("/batch", profileController.getProfilesBatch);
router.get("/batch", profileController.getProfilesBatch);

router.use(authenticate);

router.get("/check-email", profileController.checkEmailExists);
router.get("/", profileController.getAllProfiles);
router.get("/search", profileController.searchProfiles);
router.get("/my-profile", profileController.getMyProfile);
router.put("/my-profile", profileController.updateMyProfile);
router.get("/my-personal-details", profileController.getMyPersonalDetails);
router.get("/my-professional-details", profileController.getMyProfessionalDetails);
router.get("/my-subscription-details", profileController.getMySubscriptionDetails);
router.get("/my-details", profileController.getMyAllDetails);
router.get("/aggregated-user-details", aggregatedUserDetailsController.getAggregatedUserDetails);
router.get("/corn-market/new", profileController.getCornMarketNew);
router.get("/corn-market/graduate", profileController.getCornMarketGraduate);
router.get("/:profileId", profileController.getProfileById);
router.put("/:profileId", profileController.updateProfile);
router.delete("/:profileId", profileController.softDeleteProfile);

module.exports = router;

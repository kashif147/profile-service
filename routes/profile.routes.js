const express = require("express");
const router = express.Router();
const profileValidationController = require("../controllers/profile.validation.controller.js");
const profileController = require("../controllers/profile.controller.js");
const { authenticate } = require("../middlewares/auth");

router.post("/validate", profileValidationController.validateProfile);

router.use(authenticate);

router.get("/check-email", profileController.checkEmailExists);
router.get("/", profileController.getAllProfiles);
router.get("/search", profileController.searchProfiles);
router.get("/my-profile", profileController.getMyProfile);
router.put("/my-profile", profileController.updateMyProfile);
router.get("/corn-market/new", profileController.getCornMarketNew);
router.get("/corn-market/graduate", profileController.getCornMarketGraduate);
router.get("/:profileId", profileController.getProfileById);
router.put("/:profileId", profileController.updateProfile);
router.delete("/:profileId", profileController.softDeleteProfile);

module.exports = router;

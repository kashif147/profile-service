const express = require("express");
const router = express.Router();
const cornMarketController = require("../controllers/corn.market.controller");
const { authenticate } = require("../middlewares/auth");
const { requireCrm } = require("../middlewares/memberAccess");

// P5: legacy member export -> CRM + profile:read, same as /profile/corn-market/new|graduate.
// Non-ASU CRM is currently refused by the PDP category rule on `profile` (not role support).
router.get(
  "/",
  authenticate,
  requireCrm("profile", "read"),
  cornMarketController.getCornMarketProfiles
);

module.exports = router;

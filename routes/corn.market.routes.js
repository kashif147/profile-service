const express = require("express");
const router = express.Router();
const cornMarketController = require("../controllers/corn.market.controller");
const { authenticate } = require("../middlewares/auth");


router.get(
  "/",
  authenticate,
  cornMarketController.getCornMarketProfiles
);

module.exports = router;

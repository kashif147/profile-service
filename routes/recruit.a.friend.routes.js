const express = require("express");
const router = express.Router();
const recruitAFriendController = require("../controllers/recruit.a.friend.controller");
const { authenticate } = require("../middlewares/auth");


router.get("/", authenticate, recruitAFriendController.getRecruitAFriendProfiles);

module.exports = router;

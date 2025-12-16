const express = require("express");
const router = express.Router();
const universalSearchController = require("../controllers/universal.search.controller");
const { authenticate } = require("../middlewares/auth");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");


router.post(
  "/search",
  authenticate,
  defaultPolicyMiddleware.requirePermission("portal", "read"),
  universalSearchController.search.bind(universalSearchController)
);

module.exports = router;


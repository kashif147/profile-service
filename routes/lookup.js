const express = require("express");
const router = express.Router();
const lookupController = require("../controllers/lookupController");
const ROLES_LIST = require("../config/roles_list");
const verifyRoles = require("../middlewares/verifyRoles");

// Get all lookups
router
  .route("/")
  .get(lookupController.getAllLookup)
  .post(verifyRoles(ROLES_LIST.Admin, ROLES_LIST.Editor), lookupController.createNewLookup)
  .put(verifyRoles(ROLES_LIST.Admin, ROLES_LIST.Editor), lookupController.updateLookup)
  .delete(verifyRoles(ROLES_LIST.Admin), lookupController.deleteLookup);

// Get lookup by ID
router.route("/:id").get(lookupController.getLookup);

module.exports = router;

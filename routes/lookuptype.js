const express = require("express");
const router = express.Router();
const lookupTypeController = require("../controllers/lookupTypeController");
const ROLES_LIST = require("../config/roles_list");
const verifyRoles = require("../middlewares/verifyRoles");

router
  .route("/")
  .get(lookupTypeController.getAllLookupType)
  .post(verifyRoles(ROLES_LIST.Admin, ROLES_LIST.Editor), lookupTypeController.createNewLookupType)
  .put(verifyRoles(ROLES_LIST.Admin, ROLES_LIST.Editor), lookupTypeController.updateLookupType)
  .delete(verifyRoles(ROLES_LIST.Admin), lookupTypeController.deleteLookupType);

router.route("/:id").get(lookupTypeController.getLookupType);

module.exports = router;

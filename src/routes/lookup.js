import { Router } from "express";
import * as lookupController from "../controllers/lookupController.js";
import ROLES_LIST from "../config/roles_list.js";
import verifyRoles from "../middlewares/verifyRoles.js";

const router = Router();

// Get all lookups
router
  .route("/")
  .get(lookupController.getAllLookup)
  .post(
    verifyRoles(ROLES_LIST.Admin, ROLES_LIST.Editor),
    lookupController.createNewLookup
  )
  .put(
    verifyRoles(ROLES_LIST.Admin, ROLES_LIST.Editor),
    lookupController.updateLookup
  )
  .delete(verifyRoles(ROLES_LIST.Admin), lookupController.deleteLookup);

// Get lookup by ID
router.route("/:id").get(lookupController.getLookup);

export default router;

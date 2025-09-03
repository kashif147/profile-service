import { Router } from "express";
import * as lookupTypeController from "../controllers/lookupTypeController.js";
import ROLES_LIST from "../config/roles_list.js";
import verifyRoles from "../middlewares/verifyRoles.js";

const router = Router();

router
  .route("/")
  .get(lookupTypeController.getAllLookupType)
  .post(
    verifyRoles(ROLES_LIST.Admin, ROLES_LIST.Editor),
    lookupTypeController.createNewLookupType
  )
  .put(
    verifyRoles(ROLES_LIST.Admin, ROLES_LIST.Editor),
    lookupTypeController.updateLookupType
  )
  .delete(verifyRoles(ROLES_LIST.Admin), lookupTypeController.deleteLookupType);

router.route("/:id").get(lookupTypeController.getLookupType);

export default router;

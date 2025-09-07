import { Router } from "express";
import verifyJWT from "../middlewares/verifyJWT.js";
import {
  authorizeAny,
  requirePermission,
  requireAnyPermission,
  PERMISSIONS,
} from "../middlewares/auth.js";
import { idempotency } from "../middlewares/idempotency.js";
import { validate } from "../middlewares/validate.js";
import { saveOverlayDraft } from "../controllers/overlay.controller.js";
import {
  approveApplication,
  rejectApplication,
} from "../controllers/profileApproval.controller.js";
import {
  ReviewDraftBody,
  ApproveBody,
  RejectBody,
} from "../validators/applications.validators.js";
import { ApplicationParams } from "../validators/params.validators.js";
const router = Router();

// Profile Service Routes with Permission-based Authorization
// Uses shared constants for consistent permission management across microservices

// Application review and approval routes with permission-based authorization
router.post(
  "/:applicationId/review-draft",
  verifyJWT,
  requirePermission(PERMISSIONS.PROFILE.WRITE),
  idempotency(),
  validate(ReviewDraftBody),
  saveOverlayDraft
);

router.post(
  "/:applicationId/approve",
  verifyJWT,
  requirePermission(PERMISSIONS.PROFILE.WRITE),
  idempotency(),
  validate({ params: ApplicationParams, body: ApproveBody }),
  approveApplication
);

router.post(
  "/:applicationId/reject",
  verifyJWT,
  requirePermission(PERMISSIONS.PROFILE.WRITE),
  validate(RejectBody),
  rejectApplication
);

// Profile management routes with permission-based authorization
router.get(
  "/:applicationId/profile",
  verifyJWT,
  requirePermission(PERMISSIONS.PROFILE.READ),
  (req, res) => {
    res.success({
      message: "Profile access granted",
      user: req.user,
      applicationId: req.params.applicationId,
    });
  }
);

router.put(
  "/:applicationId/profile",
  verifyJWT,
  requirePermission(PERMISSIONS.PROFILE.WRITE),
  (req, res) => {
    res.success({
      message: "Profile update granted",
      user: req.user,
      applicationId: req.params.applicationId,
    });
  }
);

// Profile file operations with specific permissions
router.post(
  "/:applicationId/profile/upload",
  verifyJWT,
  requirePermission(PERMISSIONS.PROFILE.UPLOAD),
  (req, res) => {
    res.success({
      message: "File upload granted",
      user: req.user,
      applicationId: req.params.applicationId,
    });
  }
);

router.get(
  "/:applicationId/profile/download",
  verifyJWT,
  requirePermission(PERMISSIONS.PROFILE.DOWNLOAD),
  (req, res) => {
    res.success({
      message: "File download granted",
      user: req.user,
      applicationId: req.params.applicationId,
    });
  }
);

// Administrative routes requiring multiple permissions
router.delete(
  "/:applicationId/profile",
  verifyJWT,
  requireAnyPermission(PERMISSIONS.PROFILE.DELETE, PERMISSIONS.USER.DELETE),
  (req, res) => {
    res.success({
      message: "Profile deletion granted",
      user: req.user,
      applicationId: req.params.applicationId,
    });
  }
);

export default router;

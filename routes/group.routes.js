const express = require("express");
const router = express.Router();
const groupController = require("../controllers/group.controller");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");

// Policy resource "groups" — only read/write actions (shared policy engine's fixed action
// enum, see .claude/rules/architecture-boundaries.md Rule "resource:action" constraint).

router.post(
  "/",
  defaultPolicyMiddleware.requirePermission("groups", "write"),
  groupController.createGroup,
);

// GET /groups?search=&workplace=&branch=&region=&iroUserId= — searchable/drillable group list.
router.get(
  "/",
  defaultPolicyMiddleware.requirePermission("groups", "read"),
  groupController.listGroups,
);

// Must be registered before GET /:id so "/:id/members" resolves to the members handler.
router.get(
  "/:id/members",
  defaultPolicyMiddleware.requirePermission("groups", "read"),
  groupController.getGroupMembers,
);

router.get(
  "/:id",
  defaultPolicyMiddleware.requirePermission("groups", "read"),
  groupController.getGroupById,
);

router.put(
  "/:id",
  defaultPolicyMiddleware.requirePermission("groups", "write"),
  groupController.updateGroup,
);

router.delete(
  "/:id",
  defaultPolicyMiddleware.requirePermission("groups", "write"),
  groupController.deleteGroup,
);

module.exports = router;

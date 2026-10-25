const express = require("express");
const router = express.Router();
const membershipDriveController = require("../controllers/membershipDrive.controller");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");

// Policy resource "membership-drives" - read/write only, same as "groups". The resource's
// permissions must be seeded in user-service and granted to the staff roles that run drives
// before these routes PERMIT anyone (unknown resources evaluate to DENY).
const read = defaultPolicyMiddleware.requirePermission("membership-drives", "read");
const write = defaultPolicyMiddleware.requirePermission("membership-drives", "write");

// GET / lists the caller's own drives (?status=&page=&limit=&includeStats=true).
router.get("/", read, membershipDriveController.listMyDrives);
router.post("/", write, membershipDriveController.createDrive);

// Sub-resource routes are registered before "/:id" for readability; they don't collide.
router.get("/:id/stats", read, membershipDriveController.getDriveStats);
// Recruited applications/members, paginated - drive owner only.
router.get("/:id/registrations", read, membershipDriveController.listRegistrations);
router.post("/:id/registrations", write, membershipDriveController.linkRegistration);
router.delete(
  "/:id/registrations/:applicationId",
  write,
  membershipDriveController.unlinkRegistration,
);
router.patch("/:id/status", write, membershipDriveController.changeStatus);

router.get("/:id", read, membershipDriveController.getDrive);
router.put("/:id", write, membershipDriveController.updateDrive);
// Soft delete: marks the drive INACTIVE, registrations keep their tag.
router.delete("/:id", write, membershipDriveController.deleteDrive);

module.exports = router;

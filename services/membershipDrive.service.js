const mongoose = require("mongoose");
const MembershipDrive = require("../models/membershipDrive.model");
const PersonalDetails = require("../models/personal.details.model");
const SubscriptionDetails = require("../models/subscription.model");
const { AppError } = require("../errors/AppError");
const {
  STATUS_TRANSITIONS,
  EDITABLE_STATUSES,
  LINKABLE_STATUSES,
  REJOIN_MEMBERSHIP_STATUS,
} = require("../constants/membershipDrive.constants");

/*
 * Every function takes the trusted tenantId (and the acting staff userId) as explicit
 * arguments and puts tenantId into every query - a drive or application in another tenant
 * is indistinguishable from one that doesn't exist. Ownership checks run after the
 * tenant-scoped load, so a non-owner in the same tenant gets 403 and a caller in another
 * tenant gets 404.
 */

const STATS_TIMEZONE = process.env.MEMBERSHIP_DRIVE_STATS_TIMEZONE || "Europe/Dublin";
const MAX_LIST_LIMIT = 100;

function isObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id) && String(id).length === 24;
}

/** Start of the current calendar day in `timeZone`, as a UTC Date. */
function startOfToday(now = new Date(), timeZone = STATS_TIMEZONE) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const wallClockAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = wallClockAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  const midnightWallClock = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  return new Date(midnightWallClock - offsetMs);
}

function assertOwner(drive, userId) {
  if (String(drive.ownerUserId) !== String(userId)) {
    throw AppError.forbidden("Only the drive owner can change this drive");
  }
}

async function loadDrive(tenantId, driveId) {
  if (!isObjectId(driveId)) throw AppError.badRequest("Invalid drive id");
  const drive = await MembershipDrive.findOne({ _id: driveId, tenantId });
  if (!drive) throw AppError.notFound("Membership drive not found");
  return drive;
}

async function createDrive(tenantId, userId, payload) {
  return MembershipDrive.create({
    ...payload,
    tenantId,
    ownerUserId: String(userId),
    status: payload.status || "DRAFT",
    statusChangedAt: new Date(),
    updatedBy: String(userId),
  });
}

async function listMyDrives(tenantId, userId, { status, page = 1, limit = 20 } = {}) {
  const filter = { tenantId, ownerUserId: String(userId) };
  if (status) filter.status = status;
  else filter.status = { $ne: "INACTIVE" };

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), MAX_LIST_LIMIT);
  const safePage = Math.max(Number(page) || 1, 1);

  const [drives, total] = await Promise.all([
    MembershipDrive.find(filter)
      .sort({ startDate: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    MembershipDrive.countDocuments(filter),
  ]);
  return { drives, total, page: safePage, limit: safeLimit };
}

async function getDrive(tenantId, driveId) {
  const drive = await loadDrive(tenantId, driveId);
  return drive.toObject ? drive.toObject() : drive;
}

async function updateDrive(tenantId, userId, driveId, payload) {
  const drive = await loadDrive(tenantId, driveId);
  assertOwner(drive, userId);
  if (!EDITABLE_STATUSES.includes(drive.status)) {
    throw AppError.conflict(`A ${drive.status} drive can no longer be edited`);
  }

  const startDate = payload.startDate !== undefined ? payload.startDate : drive.startDate;
  const endDate = payload.endDate !== undefined ? payload.endDate : drive.endDate;
  if (new Date(endDate) < new Date(startDate)) {
    throw AppError.badRequest("endDate must be on or after startDate");
  }

  Object.assign(drive, payload, { updatedBy: String(userId) });
  await drive.save();
  return drive.toObject ? drive.toObject() : drive;
}

async function changeStatus(tenantId, userId, driveId, nextStatus) {
  const drive = await loadDrive(tenantId, driveId);
  assertOwner(drive, userId);
  if (drive.status === nextStatus) return drive.toObject ? drive.toObject() : drive;

  const allowed = STATUS_TRANSITIONS[drive.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw AppError.conflict(`Cannot move a drive from ${drive.status} to ${nextStatus}`);
  }
  drive.status = nextStatus;
  drive.statusChangedAt = new Date();
  drive.updatedBy = String(userId);
  await drive.save();
  return drive.toObject ? drive.toObject() : drive;
}

/** DELETE is a soft delete: the drive becomes INACTIVE and keeps its registrations. */
async function deactivateDrive(tenantId, userId, driveId) {
  return changeStatus(tenantId, userId, driveId, "INACTIVE");
}

/**
 * Tag an application (staging PersonalDetails, same tenant) with this drive. Any staff
 * member in the tenant may register members under a running drive - officers often recruit
 * at a colleague's drive - but only the owner can unlink.
 */
async function linkRegistration(tenantId, userId, driveId, applicationId) {
  const drive = await loadDrive(tenantId, driveId);
  if (!LINKABLE_STATUSES.includes(drive.status)) {
    throw AppError.conflict("Registrations can only be added to an IN_PROGRESS drive");
  }

  const application = await PersonalDetails.findOne({
    tenantId,
    applicationId,
    "meta.deleted": { $ne: true },
  })
    .select("applicationId membershipDrive")
    .lean();
  if (!application) throw AppError.notFound("Application not found");

  const currentDriveId = application.membershipDrive?.driveId;
  if (currentDriveId && String(currentDriveId) === String(drive._id)) {
    return { applicationId, driveId: String(drive._id), alreadyLinked: true };
  }
  if (currentDriveId) {
    throw AppError.conflict("Application is already registered under another drive");
  }

  // Conditional on the drive still being unset, so two concurrent links can't both win.
  const result = await PersonalDetails.updateOne(
    {
      tenantId,
      applicationId,
      $or: [{ "membershipDrive.driveId": null }, { "membershipDrive.driveId": { $exists: false } }],
    },
    {
      $set: {
        "membershipDrive.driveId": String(drive._id),
        "membershipDrive.linkedAt": new Date(),
        "membershipDrive.linkedBy": String(userId),
      },
    },
  );
  if (!result || result.matchedCount === 0) {
    throw AppError.conflict("Application is already registered under another drive");
  }
  return { applicationId, driveId: String(drive._id), alreadyLinked: false };
}

async function unlinkRegistration(tenantId, userId, driveId, applicationId) {
  const drive = await loadDrive(tenantId, driveId);
  assertOwner(drive, userId);
  const result = await PersonalDetails.updateOne(
    { tenantId, applicationId, "membershipDrive.driveId": String(drive._id) },
    {
      $set: {
        "membershipDrive.driveId": null,
        "membershipDrive.linkedAt": null,
        "membershipDrive.linkedBy": null,
      },
    },
  );
  if (!result || result.matchedCount === 0) {
    throw AppError.notFound("Application is not registered under this drive");
  }
  return { applicationId, driveId: String(drive._id) };
}

/** today / total / rejoins for one drive, all tenant scoped. */
async function computeStats(tenantId, drive, now = new Date()) {
  const driveFilter = {
    tenantId,
    "membershipDrive.driveId": String(drive._id),
    "meta.deleted": { $ne: true },
  };

  const [total, today, applicationIds] = await Promise.all([
    PersonalDetails.countDocuments(driveFilter),
    PersonalDetails.countDocuments({
      ...driveFilter,
      "membershipDrive.linkedAt": { $gte: startOfToday(now) },
    }),
    PersonalDetails.distinct("applicationId", driveFilter),
  ]);

  const rejoins = applicationIds.length
    ? await SubscriptionDetails.countDocuments({
        tenantId,
        applicationId: { $in: applicationIds },
        "subscriptionDetails.membershipStatus": REJOIN_MEMBERSHIP_STATUS,
      })
    : 0;

  const signUpTarget = Number(drive.signUpTarget) || 0;
  return {
    today,
    total,
    rejoins,
    signUpTarget,
    remainingToTarget: Math.max(signUpTarget - total, 0),
  };
}

async function getDriveStats(tenantId, driveId) {
  const drive = await loadDrive(tenantId, driveId);
  return { driveId: String(drive._id), ...(await computeStats(tenantId, drive)) };
}

module.exports = {
  createDrive,
  listMyDrives,
  getDrive,
  updateDrive,
  changeStatus,
  deactivateDrive,
  linkRegistration,
  unlinkRegistration,
  computeStats,
  getDriveStats,
  startOfToday,
};

const mongoose = require("mongoose");
const MembershipDrive = require("../models/membershipDrive.model");
const PersonalDetails = require("../models/personal.details.model");
const SubscriptionDetails = require("../models/subscription.model");
const Profile = require("../models/profile.model");
const { AppError } = require("../errors/AppError");
const { getTenantTimezone, FALLBACK_TIMEZONE } = require("./tenantTimezone.service");
const {
  STATUS_TRANSITIONS,
  EDITABLE_STATUSES,
  LATE_LINK_GRACE_DAYS,
  REJOIN_MEMBERSHIP_STATUS,
} = require("../constants/membershipDrive.constants");

/*
 * Every function takes the trusted tenantId (and the acting staff userId) as explicit
 * arguments and puts tenantId into every query - a drive or application in another tenant
 * is indistinguishable from one that doesn't exist. Ownership checks run after the
 * tenant-scoped load, so a non-owner in the same tenant gets 403 and a caller in another
 * tenant gets 404.
 *
 * Calendar dates (drive window, "today") are evaluated in the organisation timezone
 * (Tenant.regionalSettings.timezone, Europe/Dublin fallback - see tenantTimezone.service).
 */

const MAX_LIST_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

function isObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id) && String(id).length === 24;
}

function wallClockParts(date, timeZone) {
  return Object.fromEntries(
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
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
}

/** Calendar date ("YYYY-MM-DD") of `date` in `timeZone`. */
function localDate(date, timeZone = FALLBACK_TIMEZONE) {
  const p = wallClockParts(new Date(date), timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Drive start/end are calendar dates. The API takes "YYYY-MM-DD", which is stored as UTC
 * midnight, so the UTC date is the calendar date the officer picked.
 */
function driveCalendarDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

/** Start of the current calendar day in `timeZone`, as a UTC Date. */
function startOfToday(now = new Date(), timeZone = FALLBACK_TIMEZONE) {
  const p = wallClockParts(now, timeZone);
  const wallClockAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offsetMs = wallClockAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day) - offsetMs);
}

function assertOwner(drive, userId) {
  if (String(drive.ownerUserId) !== String(userId)) {
    throw AppError.forbidden("Only the drive owner can change this drive");
  }
}

function plain(doc) {
  return doc && doc.toObject ? doc.toObject() : doc;
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
    status: "DRAFT",
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
  return plain(await loadDrive(tenantId, driveId));
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
  return plain(drive);
}

async function changeStatus(tenantId, userId, driveId, nextStatus) {
  const drive = await loadDrive(tenantId, driveId);
  assertOwner(drive, userId);
  if (drive.status === nextStatus) return plain(drive);

  const allowed = STATUS_TRANSITIONS[drive.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw AppError.conflict(`Cannot move a drive from ${drive.status} to ${nextStatus}`);
  }
  drive.status = nextStatus;
  drive.statusChangedAt = new Date();
  drive.updatedBy = String(userId);
  await drive.save();
  return plain(drive);
}

/** DELETE is a soft delete: the drive becomes INACTIVE and keeps its registrations. */
async function deactivateDrive(tenantId, userId, driveId) {
  return changeStatus(tenantId, userId, driveId, "INACTIVE");
}

/** True while a COMPLETED drive is still inside its late-registration grace period. */
function withinLateGrace(drive, now) {
  const completedAt = drive.statusChangedAt ? new Date(drive.statusChangedAt) : null;
  return !!completedAt && now.getTime() - completedAt.getTime() <= LATE_LINK_GRACE_DAYS * DAY_MS;
}

/**
 * Who may attribute (or un-attribute) an application to this drive right now.
 *   IN_PROGRESS: any staff member in the tenant (officers recruit at colleagues' drives);
 *                un-attributing is owner-only.
 *   COMPLETED:   owner only, and only within LATE_LINK_GRACE_DAYS of completion -
 *                for paperwork that arrives after the drive closes.
 *   DRAFT / INACTIVE: nobody.
 * Returns { late } or throws.
 */
function assertAttributionAllowed(drive, userId, now, { unlink = false } = {}) {
  if (drive.status === "IN_PROGRESS") {
    if (unlink) assertOwner(drive, userId);
    return { late: false };
  }
  if (drive.status === "COMPLETED") {
    assertOwner(drive, userId);
    if (!withinLateGrace(drive, now)) {
      throw AppError.conflict(
        `The late-registration period for this drive ended ${LATE_LINK_GRACE_DAYS} days after completion`,
        { reason: "LATE_REGISTRATION_CLOSED" },
      );
    }
    return { late: true };
  }
  throw AppError.conflict("Registrations can only be attributed to an IN_PROGRESS drive", {
    reason: "DRIVE_NOT_ACCEPTING",
  });
}

/**
 * Attribute an application (staging PersonalDetails, same tenant) to this drive. The
 * application must belong to the caller's tenant and must have been created within the
 * drive's calendar window, so a drive can't claim members recruited before it started or
 * after it ended.
 */
async function linkRegistration(tenantId, userId, driveId, applicationId, { now = new Date() } = {}) {
  const drive = await loadDrive(tenantId, driveId);
  const { late } = assertAttributionAllowed(drive, userId, now);

  const application = await PersonalDetails.findOne({
    tenantId,
    applicationId,
    "meta.deleted": { $ne: true },
  })
    .select("applicationId createdAt membershipDrive")
    .lean();
  if (!application) throw AppError.notFound("Application not found");

  const currentDriveId = application.membershipDrive?.driveId;
  if (currentDriveId && String(currentDriveId) === String(drive._id)) {
    return { applicationId, driveId: String(drive._id), alreadyLinked: true, late: !!application.membershipDrive?.late };
  }
  if (currentDriveId) {
    throw AppError.conflict("Application is already registered under another drive", {
      reason: "ALREADY_ATTRIBUTED",
    });
  }

  const timeZone = await getTenantTimezone(tenantId);
  const createdOn = localDate(application.createdAt || now, timeZone);
  if (createdOn < driveCalendarDate(drive.startDate) || createdOn > driveCalendarDate(drive.endDate)) {
    throw AppError.conflict("Application was not created within the drive's dates", {
      reason: "OUTSIDE_DRIVE_WINDOW",
    });
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
        "membershipDrive.linkedAt": now,
        "membershipDrive.linkedBy": String(userId),
        "membershipDrive.late": late,
      },
    },
  );
  if (!result || result.matchedCount === 0) {
    throw AppError.conflict("Application is already registered under another drive", {
      reason: "ALREADY_ATTRIBUTED",
    });
  }
  return { applicationId, driveId: String(drive._id), alreadyLinked: false, late };
}

async function unlinkRegistration(tenantId, userId, driveId, applicationId, { now = new Date() } = {}) {
  const drive = await loadDrive(tenantId, driveId);
  assertAttributionAllowed(drive, userId, now, { unlink: true });
  const result = await PersonalDetails.updateOne(
    { tenantId, applicationId, "membershipDrive.driveId": String(drive._id) },
    {
      $set: {
        "membershipDrive.driveId": null,
        "membershipDrive.linkedAt": null,
        "membershipDrive.linkedBy": null,
        "membershipDrive.late": false,
      },
    },
  );
  if (!result || result.matchedCount === 0) {
    throw AppError.notFound("Application is not registered under this drive");
  }
  return { applicationId, driveId: String(drive._id) };
}

function driveApplicationsFilter(tenantId, drive) {
  return {
    tenantId,
    "membershipDrive.driveId": String(drive._id),
    "meta.deleted": { $ne: true },
  };
}

/** today / total / rejoins for one drive, all tenant scoped. */
async function computeStats(tenantId, drive, { now = new Date(), timeZone } = {}) {
  const tz = timeZone || (await getTenantTimezone(tenantId));
  const driveFilter = driveApplicationsFilter(tenantId, drive);

  const [applicationIds, todayIds] = await Promise.all([
    PersonalDetails.distinct("applicationId", driveFilter),
    PersonalDetails.distinct("applicationId", {
      ...driveFilter,
      "membershipDrive.linkedAt": { $gte: startOfToday(now, tz) },
    }),
  ]);

  const rejoinIds = applicationIds.length
    ? await SubscriptionDetails.distinct("applicationId", {
        tenantId,
        applicationId: { $in: applicationIds },
        "subscriptionDetails.membershipStatus": REJOIN_MEMBERSHIP_STATUS,
      })
    : [];

  const total = applicationIds.length;
  const signUpTarget = Number(drive.signUpTarget) || 0;
  return {
    today: todayIds.length,
    total,
    rejoins: rejoinIds.length,
    signUpTarget,
    remainingToTarget: Math.max(signUpTarget - total, 0),
    timeZone: tz,
  };
}

async function getDriveStats(tenantId, driveId) {
  const drive = await loadDrive(tenantId, driveId);
  return { driveId: String(drive._id), ...(await computeStats(tenantId, drive)) };
}

/**
 * Paginated recruited applications for one drive - owner only, since rows carry member
 * names. Minimal fields: who, application state, when attributed, rejoin flag, and the
 * member's profile id / membership number once approved.
 */
async function listRegistrations(tenantId, userId, driveId, { page = 1, limit = 20, applicationStatus } = {}) {
  const drive = await loadDrive(tenantId, driveId);
  assertOwner(drive, userId);

  const filter = driveApplicationsFilter(tenantId, drive);
  if (applicationStatus) filter.applicationStatus = String(applicationStatus);

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), MAX_LIST_LIMIT);
  const safePage = Math.max(Number(page) || 1, 1);

  const [rows, total] = await Promise.all([
    PersonalDetails.find(filter)
      .select(
        "applicationId applicationStatus profileId createdAt membershipDrive personalInfo.forename personalInfo.surname personalInfo.fullName",
      )
      .sort({ "membershipDrive.linkedAt": -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    PersonalDetails.countDocuments(filter),
  ]);

  const applicationIds = rows.map((r) => r.applicationId);
  const profileIds = rows.map((r) => r.profileId).filter(Boolean).map(String);
  const [rejoinIds, profiles] = await Promise.all([
    applicationIds.length
      ? SubscriptionDetails.distinct("applicationId", {
          tenantId,
          applicationId: { $in: applicationIds },
          "subscriptionDetails.membershipStatus": REJOIN_MEMBERSHIP_STATUS,
        })
      : [],
    profileIds.length
      ? Profile.find({ tenantId, _id: { $in: profileIds } }).select("membershipNumber").lean()
      : [],
  ]);
  const rejoin = new Set(rejoinIds.map(String));
  const membershipNumberByProfile = new Map(profiles.map((p) => [String(p._id), p.membershipNumber || null]));

  const registrations = rows.map((r) => ({
    applicationId: r.applicationId,
    applicationStatus: r.applicationStatus || null,
    forename: r.personalInfo?.forename || null,
    surname: r.personalInfo?.surname || null,
    fullName:
      r.personalInfo?.fullName ||
      [r.personalInfo?.forename, r.personalInfo?.surname].filter(Boolean).join(" ") ||
      null,
    applicationCreatedAt: r.createdAt || null,
    linkedAt: r.membershipDrive?.linkedAt || null,
    linkedBy: r.membershipDrive?.linkedBy || null,
    late: !!r.membershipDrive?.late,
    isRejoin: rejoin.has(String(r.applicationId)),
    profileId: r.profileId ? String(r.profileId) : null,
    membershipNumber: r.profileId ? membershipNumberByProfile.get(String(r.profileId)) || null : null,
  }));

  return { registrations, total, page: safePage, limit: safeLimit };
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
  listRegistrations,
  startOfToday,
  localDate,
};

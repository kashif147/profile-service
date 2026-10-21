"use strict";
/**
 * Membership drives - tenant A/B isolation, owner-only mutation, trusted-context identity,
 * status lifecycle, registration tagging and stats. Real controller + service, in-memory
 * models (no DB).
 */
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.LOG_ROOT =
  process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-drives-"));
process.env.NODE_ENV = process.env.NODE_ENV || "test";

jest.mock("uuid", () => ({ v4: () => "00000000-0000-4000-8000-000000000000" }));
const mm = () => require("./helpers/memoryModel");
jest.mock("../models/membershipDrive.model", () => mm().createMemoryModel("MembershipDrive"));
jest.mock("../models/personal.details.model", () => mm().createMemoryModel("personalDetails"));
jest.mock("../models/subscription.model", () => mm().createMemoryModel("subscriptionDetails"));

const { mockRes } = require("./helpers/memoryModel");
const MembershipDrive = require("../models/membershipDrive.model");
const PersonalDetails = require("../models/personal.details.model");
const SubscriptionDetails = require("../models/subscription.model");
const drives = require("../controllers/membershipDrive.controller");
const { startOfToday } = require("../services/membershipDrive.service");

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const IRO_A = "a10000000000000000000001";
const IRO_A2 = "a10000000000000000000002";
const IRO_B = "b10000000000000000000001";
const DRIVE_A = "a50000000000000000000001";
const DRIVE_B = "b50000000000000000000001";

const req = (tenantId, userId, extra = {}) => ({
  tenantId,
  ctx: { tenantId, userId },
  user: { id: userId, tenantId, userType: "CRM" },
  userId,
  headers: {},
  params: {},
  query: {},
  body: {},
  ...extra,
});

async function invoke(fn, r) {
  const res = mockRes();
  let err;
  await fn(r, res, (e) => {
    err = e;
  });
  return { res, err, data: res.body?.data };
}

const driveDoc = (overrides) => ({
  name: "Drive",
  driveType: "WORKPLACE",
  workLocations: ["wl-1"],
  startDate: new Date("2026-10-01"),
  endDate: new Date("2026-12-31"),
  signUpTarget: 10,
  notes: null,
  status: "IN_PROGRESS",
  ...overrides,
});

beforeEach(() => {
  for (const M of [MembershipDrive, PersonalDetails, SubscriptionDetails]) M.reset();
  MembershipDrive.seed([
    driveDoc({ _id: DRIVE_A, tenantId: A, ownerUserId: IRO_A, name: "A drive" }),
    driveDoc({ _id: DRIVE_B, tenantId: B, ownerUserId: IRO_B, name: "B drive" }),
  ]);
  PersonalDetails.seed([
    { tenantId: A, applicationId: "app-a1", meta: { deleted: false }, membershipDrive: { driveId: null } },
    { tenantId: A, applicationId: "app-a2", meta: { deleted: false }, membershipDrive: { driveId: null } },
    { tenantId: B, applicationId: "app-b1", meta: { deleted: false }, membershipDrive: { driveId: null } },
  ]);
});

describe("create", () => {
  test("tenant and owner come from the trusted context", async () => {
    const { err, data } = await invoke(
      drives.createDrive,
      req(A, IRO_A, {
        body: {
          name: "Ward drive",
          driveType: "WORKPLACE",
          workLocations: "wl-9",
          startDate: "2026-11-01",
          endDate: "2026-11-30",
          signUpTarget: 25,
        },
      }),
    );
    expect(err).toBeUndefined();
    expect(data).toMatchObject({
      tenantId: A,
      ownerUserId: IRO_A,
      status: "DRAFT",
      workLocations: ["wl-9"],
    });
  });

  test.each([
    ["tenantId", { tenantId: B }],
    ["ownerUserId", { ownerUserId: IRO_B }],
    ["status", { status: "COMPLETED" }],
  ])("rejects a client-supplied %s", async (_label, extra) => {
    const { err } = await invoke(
      drives.createDrive,
      req(A, IRO_A, {
        body: {
          name: "x",
          driveType: "WORKPLACE",
          workLocations: ["wl-1"],
          startDate: "2026-11-01",
          endDate: "2026-11-30",
          ...extra,
        },
      }),
    );
    expect(err).toMatchObject({ status: 400 });
    expect(MembershipDrive.store).toHaveLength(2);
  });

  test("rejects endDate before startDate", async () => {
    const { err } = await invoke(
      drives.createDrive,
      req(A, IRO_A, {
        body: {
          name: "x",
          driveType: "WORKPLACE",
          workLocations: ["wl-1"],
          startDate: "2026-11-30",
          endDate: "2026-11-01",
        },
      }),
    );
    expect(err).toMatchObject({ status: 400 });
  });

  test("fails closed without a tenant", async () => {
    const r = req(undefined, IRO_A, { ctx: { userId: IRO_A } });
    const { err } = await invoke(drives.createDrive, r);
    expect(err).toMatchObject({ status: 401 });
  });

  test("portal users are refused", async () => {
    const r = req(A, IRO_A);
    r.user.userType = "PORTAL";
    const { err } = await invoke(drives.listMyDrives, r);
    expect(err).toMatchObject({ status: 403 });
  });
});

describe("list my drives", () => {
  test("returns only the caller's drives in the caller's tenant, ignoring query identity", async () => {
    MembershipDrive.seed([driveDoc({ tenantId: A, ownerUserId: IRO_A2, name: "colleague" })]);
    const { data } = await invoke(
      drives.listMyDrives,
      req(A, IRO_A, { query: { ownerUserId: IRO_A2, tenantId: B, userId: IRO_B } }),
    );
    expect(data.drives.map((d) => d.name)).toEqual(["A drive"]);
    const listCall = MembershipDrive.calls.find((c) => c.op === "find");
    expect(listCall.filter).toMatchObject({ tenantId: A, ownerUserId: IRO_A });
  });

  test("hides INACTIVE drives unless asked for", async () => {
    MembershipDrive.seed([driveDoc({ tenantId: A, ownerUserId: IRO_A, name: "old", status: "INACTIVE" })]);
    const all = await invoke(drives.listMyDrives, req(A, IRO_A));
    expect(all.data.drives.map((d) => d.name)).toEqual(["A drive"]);
    const inactive = await invoke(drives.listMyDrives, req(A, IRO_A, { query: { status: "INACTIVE" } }));
    expect(inactive.data.drives.map((d) => d.name)).toEqual(["old"]);
  });
});

describe("cross-tenant access", () => {
  test.each([
    ["get", drives.getDrive, {}],
    ["update", drives.updateDrive, { body: { name: "hijack" } }],
    ["status", drives.changeStatus, { body: { status: "COMPLETED" } }],
    ["delete", drives.deleteDrive, {}],
    ["stats", drives.getDriveStats, {}],
    ["link", drives.linkRegistration, { body: { applicationId: "app-b1" } }],
  ])("tenant A cannot %s tenant B's drive (404, B untouched)", async (_label, fn, extra) => {
    const before = JSON.stringify(MembershipDrive.store.find((d) => d._id === DRIVE_B));
    const { err } = await invoke(fn, req(A, IRO_A, { params: { id: DRIVE_B }, ...extra }));
    expect(err).toMatchObject({ status: 404 });
    expect(JSON.stringify(MembershipDrive.store.find((d) => d._id === DRIVE_B))).toBe(before);
    expect(PersonalDetails.store.find((p) => p.applicationId === "app-b1").membershipDrive.driveId).toBeNull();
  });

  test("tenant A cannot tag tenant B's application onto its own drive", async () => {
    const { err } = await invoke(
      drives.linkRegistration,
      req(A, IRO_A, { params: { id: DRIVE_A }, body: { applicationId: "app-b1" } }),
    );
    expect(err).toMatchObject({ status: 404 });
    expect(PersonalDetails.store.find((p) => p.applicationId === "app-b1").membershipDrive.driveId).toBeNull();
  });

  test("tenant B's registrations never count toward tenant A's stats", async () => {
    // Corrupt-data case: a B application somehow carrying A's drive id.
    PersonalDetails.seed([
      { tenantId: B, applicationId: "app-b2", meta: {}, membershipDrive: { driveId: DRIVE_A, linkedAt: new Date() } },
    ]);
    SubscriptionDetails.seed([
      { tenantId: B, applicationId: "app-b2", subscriptionDetails: { membershipStatus: "rejoin" } },
    ]);
    const { data } = await invoke(drives.getDriveStats, req(A, IRO_A, { params: { id: DRIVE_A } }));
    expect(data).toMatchObject({ total: 0, today: 0, rejoins: 0 });
  });
});

describe("ownership within a tenant", () => {
  test.each([
    ["update", drives.updateDrive, { body: { name: "mine now" } }],
    ["status", drives.changeStatus, { body: { status: "COMPLETED" } }],
    ["delete", drives.deleteDrive, {}],
  ])("a colleague cannot %s another officer's drive (403)", async (_label, fn, extra) => {
    const { err } = await invoke(fn, req(A, IRO_A2, { params: { id: DRIVE_A }, ...extra }));
    expect(err).toMatchObject({ status: 403 });
    expect(MembershipDrive.store.find((d) => d._id === DRIVE_A)).toMatchObject({
      name: "A drive",
      status: "IN_PROGRESS",
    });
  });

  test("a colleague in the same tenant can view and register into a running drive", async () => {
    const view = await invoke(drives.getDrive, req(A, IRO_A2, { params: { id: DRIVE_A } }));
    expect(view.err).toBeUndefined();
    const link = await invoke(
      drives.linkRegistration,
      req(A, IRO_A2, { params: { id: DRIVE_A }, body: { applicationId: "app-a1" } }),
    );
    expect(link.err).toBeUndefined();
    expect(PersonalDetails.store.find((p) => p.applicationId === "app-a1").membershipDrive).toMatchObject({
      driveId: DRIVE_A,
      linkedBy: IRO_A2,
    });
  });

  test("only the owner can unlink", async () => {
    await invoke(drives.linkRegistration, req(A, IRO_A, { params: { id: DRIVE_A }, body: { applicationId: "app-a1" } }));
    const other = await invoke(
      drives.unlinkRegistration,
      req(A, IRO_A2, { params: { id: DRIVE_A, applicationId: "app-a1" } }),
    );
    expect(other.err).toMatchObject({ status: 403 });
    const owner = await invoke(
      drives.unlinkRegistration,
      req(A, IRO_A, { params: { id: DRIVE_A, applicationId: "app-a1" } }),
    );
    expect(owner.err).toBeUndefined();
    expect(PersonalDetails.store.find((p) => p.applicationId === "app-a1").membershipDrive.driveId).toBeNull();
  });
});

describe("status lifecycle", () => {
  test("DRAFT -> IN_PROGRESS -> COMPLETED, then edits are refused", async () => {
    const created = await invoke(
      drives.createDrive,
      req(A, IRO_A, {
        body: { name: "n", driveType: "t", workLocations: ["w"], startDate: "2026-11-01", endDate: "2026-11-02" },
      }),
    );
    const id = created.data._id;
    expect((await invoke(drives.changeStatus, req(A, IRO_A, { params: { id }, body: { status: "IN_PROGRESS" } }))).data.status).toBe("IN_PROGRESS");
    expect((await invoke(drives.changeStatus, req(A, IRO_A, { params: { id }, body: { status: "COMPLETED" } }))).data.status).toBe("COMPLETED");
    const edit = await invoke(drives.updateDrive, req(A, IRO_A, { params: { id }, body: { name: "late" } }));
    expect(edit.err).toMatchObject({ status: 409 });
    const back = await invoke(drives.changeStatus, req(A, IRO_A, { params: { id }, body: { status: "IN_PROGRESS" } }));
    expect(back.err).toMatchObject({ status: 409 });
  });

  test("DELETE soft-deletes to INACTIVE and keeps registration tags", async () => {
    await invoke(drives.linkRegistration, req(A, IRO_A, { params: { id: DRIVE_A }, body: { applicationId: "app-a1" } }));
    const del = await invoke(drives.deleteDrive, req(A, IRO_A, { params: { id: DRIVE_A } }));
    expect(del.data.status).toBe("INACTIVE");
    expect(MembershipDrive.store.find((d) => d._id === DRIVE_A)).toBeTruthy();
    expect(PersonalDetails.store.find((p) => p.applicationId === "app-a1").membershipDrive.driveId).toBe(DRIVE_A);
  });

  test("update rejects an endDate before the stored startDate", async () => {
    const { err } = await invoke(
      drives.updateDrive,
      req(A, IRO_A, { params: { id: DRIVE_A }, body: { endDate: "2026-09-01" } }),
    );
    expect(err).toMatchObject({ status: 400 });
  });
});

describe("registrations and stats", () => {
  test("cannot register into a drive that is not IN_PROGRESS", async () => {
    MembershipDrive.store.find((d) => d._id === DRIVE_A).status = "DRAFT";
    const { err } = await invoke(
      drives.linkRegistration,
      req(A, IRO_A, { params: { id: DRIVE_A }, body: { applicationId: "app-a1" } }),
    );
    expect(err).toMatchObject({ status: 409 });
  });

  test("linking is idempotent for the same drive and refused for a second drive", async () => {
    const DRIVE_A2 = "a50000000000000000000002";
    MembershipDrive.seed([driveDoc({ _id: DRIVE_A2, tenantId: A, ownerUserId: IRO_A })]);
    const first = await invoke(drives.linkRegistration, req(A, IRO_A, { params: { id: DRIVE_A }, body: { applicationId: "app-a1" } }));
    expect(first.data.alreadyLinked).toBe(false);
    const again = await invoke(drives.linkRegistration, req(A, IRO_A, { params: { id: DRIVE_A }, body: { applicationId: "app-a1" } }));
    expect(again.data.alreadyLinked).toBe(true);
    const other = await invoke(drives.linkRegistration, req(A, IRO_A, { params: { id: DRIVE_A2 }, body: { applicationId: "app-a1" } }));
    expect(other.err).toMatchObject({ status: 409 });
  });

  test("stats count today, total and rejoins for the drive", async () => {
    const yesterday = new Date(startOfToday().getTime() - 60 * 60 * 1000);
    PersonalDetails.seed([
      { tenantId: A, applicationId: "app-a3", meta: {}, membershipDrive: { driveId: DRIVE_A, linkedAt: yesterday } },
      { tenantId: A, applicationId: "app-a4", meta: { deleted: true }, membershipDrive: { driveId: DRIVE_A, linkedAt: new Date() } },
    ]);
    SubscriptionDetails.seed([
      { tenantId: A, applicationId: "app-a3", subscriptionDetails: { membershipStatus: "rejoin" } },
      { tenantId: A, applicationId: "app-a1", subscriptionDetails: { membershipStatus: "new" } },
    ]);
    await invoke(drives.linkRegistration, req(A, IRO_A, { params: { id: DRIVE_A }, body: { applicationId: "app-a1" } }));

    const { data } = await invoke(drives.getDriveStats, req(A, IRO_A, { params: { id: DRIVE_A } }));
    expect(data).toEqual({
      driveId: DRIVE_A,
      today: 1,
      total: 2,
      rejoins: 1,
      signUpTarget: 10,
      remainingToTarget: 8,
    });
    for (const call of [...PersonalDetails.calls, ...SubscriptionDetails.calls].filter((c) => c.filter)) {
      expect(call.filter.tenantId).toBe(A);
    }
  });

  test("list can include per-drive stats", async () => {
    const { data } = await invoke(drives.listMyDrives, req(A, IRO_A, { query: { includeStats: "true" } }));
    expect(data.drives[0].stats).toMatchObject({ total: 0, signUpTarget: 10 });
  });
});

describe("startOfToday", () => {
  test("resolves Dublin midnight across the summer-time offset", () => {
    // 2026-07-15 10:00Z is 11:00 IST; Dublin midnight is 2026-07-14T23:00Z.
    expect(startOfToday(new Date("2026-07-15T10:00:00Z"), "Europe/Dublin").toISOString()).toBe(
      "2026-07-14T23:00:00.000Z",
    );
    // Winter: GMT, midnight is 00:00Z.
    expect(startOfToday(new Date("2026-12-15T10:00:00Z"), "Europe/Dublin").toISOString()).toBe(
      "2026-12-15T00:00:00.000Z",
    );
  });
});

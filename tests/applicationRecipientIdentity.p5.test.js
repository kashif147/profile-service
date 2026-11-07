// P5 identity: for an application submitted by a verified portal user, profile ownership AND the
// recipient of every side effect (application processed -> user-service member role, notification-
// service notifications; subscription upsert -> subscription user; GAP letter; rejection) come from
// that same submitter. A stale synced User row sharing the applicant's email receives nothing.
// Real throwaway mongod for the profile / synced-user rows; the broker publisher is captured.
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const mongoose = require("mongoose");
jest.mock("uuid", () => ({ v4: () => require("crypto").randomUUID() }));
jest.mock("@projectShell/rabbitmq-middleware", () => ({ publisher: { publish: jest.fn(async () => ({ success: true })) } }));
jest.mock("../services/profile.audit.publisher.js", () => ({ publishProfileAudit: jest.fn() }));

process.env.LOG_ROOT = process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-ari-"));
const T = "aaaaaaaaaaaaaaaaaaaaaaaa";
const haveMongod = spawnSync("mongod", ["--version"]).status === 0;
const d = haveMongod ? describe : describe.skip;

let proc, dir;
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); s.on("error", rej); });
const oid = () => new mongoose.Types.ObjectId();

d("application side-effect recipients follow the verified portal applicant (P5)", () => {
  let Profile, User, lookup, publishPostApprovalEvents, identity, publisher;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-ari-mongod-"));
    const port = await freePort();
    proc = spawn("mongod", ["--dbpath", dir, "--port", String(port), "--bind_ip", "127.0.0.1", "--quiet"], { stdio: "ignore" });
    for (let i = 0; i < 50; i += 1) {
      try { await mongoose.connect(`mongodb://127.0.0.1:${port}/app_recipient_identity`, { serverSelectionTimeoutMS: 500, autoIndex: false }); break; }
      catch { await new Promise((r) => setTimeout(r, 200)); }
    }
    Profile = require("../models/profile.model");
    User = require("../models/user.model");
    await Profile.syncIndexes();
    lookup = require("../services/profileLookup.service.js");
    ({ publishPostApprovalEvents } = require("../services/publishPostApprovalEvents.js"));
    identity = require("../helpers/portalUserIdentity.js");
    ({ publisher } = require("@projectShell/rabbitmq-middleware"));
  }, 30000);
  afterAll(async () => {
    await mongoose.disconnect().catch(() => {});
    if (proc) proc.kill("SIGTERM");
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => publisher.publish.mockClear());

  async function syncedPortalUser(email, id = oid()) {
    await User.collection.insertOne({ _id: id, userId: String(id), userEmail: email, userType: "PORTAL", isActive: true, tenantId: T });
    return id;
  }
  const effectiveFor = ({ email, userId, userType = "PORTAL", gap = false }) => ({
    ...(userId ? { userId: String(userId) } : {}),
    ...(userType ? { userType } : {}),
    personalInfo: { forename: "P5Test", surname: "Recipient" },
    contactInfo: { personalEmail: email, preferredEmail: "PERSONAL" },
    professionalDetails: {},
    subscriptionDetails: { membershipCategory: "GENERAL", ...(gap ? {} : {}) },
  });
  const published = () => publisher.publish.mock.calls.map(([routingKey, data]) => ({ routingKey, data }));
  const recipients = () => published().filter((p) => "userId" in p.data);

  async function approveLikeSingle({ email, applicant, stale }) {
    const effective = effectiveFor({ email, userId: applicant });
    const { profile, linkedUserId } = await lookup.findOrCreateProfileByEmail({ tenantId: T, effective, reviewerId: String(oid()) });
    const updatedProfile = await Profile.findById(profile._id).lean();
    await publishPostApprovalEvents({
      applicationId: "app-single", reviewerId: String(oid()), profileId: profile._id, tenantId: T, isExistingProfile: false,
      updatedProfile, linkedUserId, effective, memberId: "B99901", dateJoined: new Date(), gapLetter: { sendGapLetter: true },
      identityLinkPending: false,
    });
    return { profile: updatedProfile, stale };
  }

  test("1 single approval: stale same-email row gets no ownership, no role-grant / notification / subscription recipient", async () => {
    const email = "ari-single@example.test";
    const stale = await syncedPortalUser(email); // its user-service user no longer exists
    const applicant = oid(); // verified submitter, never synced
    const { profile } = await approveLikeSingle({ email, applicant, stale });
    expect(String(profile.userId)).toBe(String(applicant));
    const rs = recipients();
    expect(rs.map((r) => r.routingKey)).toEqual(expect.arrayContaining(["applications.review.processed.v1"]));
    expect(rs.length).toBeGreaterThanOrEqual(3); // processed, GAP letter, subscription upsert
    for (const r of rs) {
      expect(r.data.userId).toBe(String(applicant));
      expect(r.data.applicantIdentity).toEqual({ source: "portal_submitter", verified: true, pending: null });
    }
    expect(JSON.stringify(published())).not.toContain(String(stale));
  });

  test("2 bulk approval (bulk's resolver + bulk payload shape): stale same-email row receives nothing", async () => {
    const email = "ari-bulk@example.test";
    const stale = await syncedPortalUser(email);
    const applicant = oid();
    const effective = effectiveFor({ email, userId: applicant });
    // bulkApproval.controller.js: resolveApplicantPortalIdentity -> linkedUserDocumentId, then the
    // new profile via findOrCreateProfileByEmail and userId = linkedUserDocumentId.
    const ident = await lookup.resolveApplicantPortalIdentity({ tenantId: T, normalizedEmail: email, userType: "PORTAL", userId: String(applicant) });
    const { profile } = await lookup.findOrCreateProfileByEmail({ tenantId: T, effective, reviewerId: String(oid()) });
    await Profile.updateOne({ _id: profile._id }, { $set: { userId: ident.linkedUserDocumentId } });
    const updatedProfile = await Profile.findById(profile._id).lean();
    expect(String(updatedProfile.userId)).toBe(String(applicant));
    await publishPostApprovalEvents({
      applicationId: "app-bulk", reviewerId: String(oid()), profileId: profile._id, tenantId: T, isExistingProfile: false,
      updatedProfile, linkedUserId: ident.linkedUserDocumentId, effective, memberId: "B99902", dateJoined: new Date(),
      processingDate: "2026-11-07", gapLetter: null, identityLinkPending: false,
    });
    for (const r of recipients()) expect(r.data.userId).toBe(String(applicant));
    expect(JSON.stringify(published())).not.toContain(String(stale));
  });

  test("3 bulk controller routes through the shared resolver and post-approval publisher", () => {
    const src = fs.readFileSync(path.join(__dirname, "../controllers/bulkApproval.controller.js"), "utf8");
    expect(src).toMatch(/resolveApplicantPortalIdentity\(/);
    expect(src).not.toMatch(/findPortalUserByTenantEmail\(/);
    expect(src).toMatch(/identityLinkPending: !!identityLink/);
    expect(src).toMatch(/publishPostApprovalEvents\(result\.postApprovalPayload\)/);
    const single = fs.readFileSync(path.join(__dirname, "../controllers/profileApproval.controller.js"), "utf8");
    expect(single).toMatch(/identityLinkPending: !!identityLink/);
    expect(single).toMatch(/publishPostApprovalEvents\(postApprovalPayload\)/);
    for (const f of ["../controllers/profileApproval.controller.js", "../controllers/application.controller.js", "../services/publishPostApprovalEvents.js"]) {
      expect(fs.readFileSync(path.join(__dirname, f), "utf8")).not.toMatch(/resolvePortalUserServiceId\(/);
    }
  });

  test("4 identity link pending (existing profile bound to someone else): no recipient at all, marked pending", async () => {
    const email = "ari-pending@example.test";
    const stale = await syncedPortalUser(email);
    const applicant = oid();
    const effective = effectiveFor({ email, userId: applicant });
    await publishPostApprovalEvents({
      applicationId: "app-pending", reviewerId: String(oid()), profileId: oid(), tenantId: T, isExistingProfile: true,
      updatedProfile: { userId: stale, crmUserId: null }, linkedUserId: stale, effective, memberId: "B99903", dateJoined: new Date(),
      gapLetter: { sendGapLetter: true }, identityLinkPending: true,
    });
    const rs = recipients();
    expect(rs.length).toBeGreaterThanOrEqual(3);
    for (const r of rs) {
      expect(r.data.userId).toBeNull();
      expect(r.data.applicantIdentity).toEqual({ source: "portal_submitter", verified: true, pending: "IDENTITY_LINK_PENDING" });
    }
    expect(JSON.stringify(rs.map((r) => r.data.userId))).not.toContain(String(stale));
  });

  test("5 rejection / legacy recipients: verified submitter, never the stale email row", async () => {
    const email = "ari-reject@example.test";
    const stale = await syncedPortalUser(email);
    const applicant = oid();
    const r = await identity.resolveApplicationRecipient({ tenantId: T, submitterUserId: applicant, submitterUserType: "PORTAL", profileUserId: applicant, linkedUserId: applicant, userEmail: email });
    expect(r.userId).toBe(String(applicant));
    expect(r.userId).not.toBe(String(stale));
    // unset meta.userType counts as portal-originated (create listener rule)
    const r2 = await identity.resolveApplicationRecipient({ tenantId: T, submitterUserId: applicant, submitterUserType: null, userEmail: email });
    expect(r2.userId).toBe(String(applicant));
  });

  test("6 applicant with their own synced row: recipient is that row's user id", async () => {
    const email = "ari-own@example.test";
    await syncedPortalUser(email); // stale
    const own = await syncedPortalUser(email);
    const r = await identity.resolveApplicationRecipient({ tenantId: T, submitterUserId: own, submitterUserType: "PORTAL", userEmail: email });
    expect(r.userId).toBe(String(own));
  });

  test("7 CRM-created application keeps the supported resolution (profile row -> linked -> email)", async () => {
    const email = "ari-crm@example.test";
    const synced = await syncedPortalUser(email);
    const r = await identity.resolveApplicationRecipient({ tenantId: T, submitterUserId: null, submitterUserType: "CRM", profileUserId: null, linkedUserId: null, userEmail: email });
    expect(r.userId).toBe(String(synced));
    expect(r.applicantIdentity).toEqual({ source: "crm_created", verified: false, pending: null });
  });
});

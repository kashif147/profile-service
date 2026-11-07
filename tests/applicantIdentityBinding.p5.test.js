// P5 identity: a NEW profile is bound to the verified portal applicant, never to a synced portal
// User row that merely shares the applicant's email (DEV incident 2026-11-07: a stale synced row
// whose user had been deleted and re-created captured the new profile, so the applicant could not
// open it). Real throwaway mongod (skips without one).
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const mongoose = require("mongoose");
jest.mock("uuid", () => ({ v4: () => require("crypto").randomUUID() }));

process.env.LOG_ROOT = process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-aib-"));
const T = "aaaaaaaaaaaaaaaaaaaaaaaa";
const haveMongod = spawnSync("mongod", ["--version"]).status === 0;
const d = haveMongod ? describe : describe.skip;

let proc, dir;
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); s.on("error", rej); });
const oid = () => new mongoose.Types.ObjectId();

function effectiveFor({ email, userId, userType }) {
  return {
    ...(userId ? { userId } : {}),
    ...(userType ? { userType } : {}),
    personalInfo: { forename: "P5Test", surname: "Identity" },
    contactInfo: { personalEmail: email, preferredEmail: "PERSONAL" },
  };
}

d("applicant identity binding for a new profile (P5)", () => {
  let Profile, User, lookup;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-aib-mongod-"));
    const port = await freePort();
    proc = spawn("mongod", ["--dbpath", dir, "--port", String(port), "--bind_ip", "127.0.0.1", "--quiet"], { stdio: "ignore" });
    for (let i = 0; i < 50; i += 1) {
      try { await mongoose.connect(`mongodb://127.0.0.1:${port}/applicant_identity`, { serverSelectionTimeoutMS: 500, autoIndex: false }); break; }
      catch { await new Promise((r) => setTimeout(r, 200)); }
    }
    Profile = require("../models/profile.model");
    User = require("../models/user.model");
    await Profile.syncIndexes();
    lookup = require("../services/profileLookup.service.js");
  }, 30000);
  afterAll(async () => {
    await mongoose.disconnect().catch(() => {});
    if (proc) proc.kill("SIGTERM");
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  // A synced row as user.portal.* sync writes it: _id == userId (the user-service id).
  async function syncedPortalUser(email, id = oid()) {
    await User.collection.insertOne({ _id: id, userId: String(id), userEmail: email, userType: "PORTAL", isActive: true, tenantId: T });
    return id;
  }

  test("1 regression: stale synced row sharing the applicant's email does NOT capture the new profile", async () => {
    const email = "shared-stale@example.test";
    const stale = await syncedPortalUser(email); // its user-service user no longer exists
    const applicant = oid(); // verified submitter, never synced to profile-service
    const { profile, linkedUserId } = await lookup.findOrCreateProfileByEmail({
      tenantId: T, effective: effectiveFor({ email, userId: String(applicant), userType: "PORTAL" }), reviewerId: String(oid()),
    });
    const saved = await Profile.findById(profile._id).lean();
    expect(String(saved.userId)).toBe(String(applicant));
    expect(String(saved.userId)).not.toBe(String(stale));
    expect(String(linkedUserId)).toBe(String(applicant));
    // the stale row is untouched
    expect(await User.countDocuments({ _id: stale, isActive: true })).toBe(1);
  });

  test("2 applicant with their own synced row is bound to it even when another row shares the email", async () => {
    const email = "shared-two@example.test";
    const stale = await syncedPortalUser(email);
    const own = await syncedPortalUser(email);
    const { profile } = await lookup.findOrCreateProfileByEmail({
      tenantId: T, effective: effectiveFor({ email, userId: String(own), userType: "PORTAL" }), reviewerId: String(oid()),
    });
    const saved = await Profile.findById(profile._id).lean();
    expect(String(saved.userId)).toBe(String(own));
    expect(String(saved.userId)).not.toBe(String(stale));
  });

  test("3 a CRM-created application (no portal submitter) still links by email, as before", async () => {
    const email = "crm-created@example.test";
    const synced = await syncedPortalUser(email);
    const { profile } = await lookup.findOrCreateProfileByEmail({
      tenantId: T, effective: effectiveFor({ email, userType: "CRM" }), reviewerId: String(oid()),
    });
    const saved = await Profile.findById(profile._id).lean();
    expect(String(saved.userId)).toBe(String(synced));
  });

  test("4 resolveApplicantPortalIdentity: portal applicant -> own id; email row ignored; other tenant ignored", async () => {
    const email = "resolver@example.test";
    const stale = await syncedPortalUser(email);
    const applicant = oid();
    await User.collection.insertOne({ _id: applicant, userId: String(applicant), userEmail: "x@example.test", userType: "PORTAL", isActive: true, tenantId: "bbbbbbbbbbbbbbbbbbbbbbbb" });
    const r = await lookup.resolveApplicantPortalIdentity({ tenantId: T, normalizedEmail: email, userType: "PORTAL", userId: String(applicant) });
    expect(r.portalUser).toBeNull(); // the other tenant's row is not this tenant's synced user
    expect(String(r.linkedUserId)).toBe(String(applicant));
    expect(String(r.linkedUserDocumentId)).toBe(String(applicant));
    expect(String(r.linkedUserDocumentId)).not.toBe(String(stale));
    const crm = await lookup.resolveApplicantPortalIdentity({ tenantId: T, normalizedEmail: email, userType: "CRM", userId: null });
    expect(String(crm.linkedUserDocumentId)).toBe(String(stale));
  });

  test("5 bulk approval resolves the applicant through the same helper (no email-first lookup left)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../controllers/bulkApproval.controller.js"), "utf8");
    expect(src).toMatch(/resolveApplicantPortalIdentity\(/);
    expect(src).not.toMatch(/findPortalUserByTenantEmail\(/);
  });
});

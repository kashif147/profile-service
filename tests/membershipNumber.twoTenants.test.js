// Phase 2C Track D: membership numbers are unique PER TENANT. Tenant A's B00001 and tenant B's
// B00001 coexist and every lookup resolves the caller's own member only. Real throwaway mongod
// (skips without one). Also documents the DEV blocker: the legacy GLOBAL unique index
// membershipNumber_1 (still present in DEV databases) makes the two-tenant case impossible.
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const mongoose = require("mongoose");
// uuid is ESM-only and this jest setup cannot load it; the model only needs v4().
jest.mock("uuid", () => ({ v4: () => require("crypto").randomUUID() }));

process.env.LOG_ROOT = process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "ps-mn2-"));
const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const haveMongod = spawnSync("mongod", ["--version"]).status === 0;
const d = haveMongod ? describe : describe.skip;

let proc, dir;
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); s.on("error", rej); });
function callHandler(handler, req) {
  return new Promise((resolve) => {
    const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); return this; }, success(b) { resolve({ code: 200, body: { data: b } }); return this; } };
    handler(req, res, (err) => resolve({ code: err?.status || err?.statusCode || 500, body: { error: err?.message } }));
  });
}

d("membership numbers per tenant (Tenant A / Tenant B)", () => {
  let Profile, lookup, checkEmail;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ps-mn2-mongod-"));
    const port = await freePort();
    proc = spawn("mongod", ["--dbpath", dir, "--port", String(port), "--bind_ip", "127.0.0.1", "--quiet"], { stdio: "ignore" });
    for (let i = 0; i < 50; i += 1) {
      try { await mongoose.connect(`mongodb://127.0.0.1:${port}/mn_two_tenants`, { serverSelectionTimeoutMS: 500, autoIndex: false }); break; }
      catch { await new Promise((r) => setTimeout(r, 200)); }
    }
    Profile = require("../models/profile.model");
    await Profile.syncIndexes();
    ({ lookupProfilesByMembershipNumbers: lookup } = require("../controllers/profile.controller"));
    ({ checkEmailExists: checkEmail } = require("../controllers/personal.details.controller"));
  }, 30000);
  afterAll(async () => {
    await mongoose.disconnect().catch(() => {});
    if (proc) proc.kill("SIGTERM");
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  test("1 tenant A and tenant B can each hold membership number B00001", async () => {
    await Profile.collection.insertOne({ tenantId: A, membershipNumber: "B00001", normalizedEmail: "a1@example.test", isActive: true, personalInfo: { forename: "Ann" } });
    await Profile.collection.insertOne({ tenantId: B, membershipNumber: "B00001", normalizedEmail: "b1@example.test", isActive: true, personalInfo: { forename: "Bob" } });
    expect(await Profile.countDocuments({ membershipNumber: "B00001" })).toBe(2);
    await expect(Profile.collection.insertOne({ tenantId: A, membershipNumber: "B00001", normalizedEmail: "dup@example.test" })).rejects.toThrow(/E11000/);
  });

  test("2 lookup by membership number resolves the caller's own member only", async () => {
    const a = await callHandler(lookup, { tenantId: A, body: { membershipNumbers: ["B00001"] } });
    const b = await callHandler(lookup, { tenantId: B, body: { membershipNumbers: ["B00001"] } });
    expect(a.body.data).toHaveLength(1);
    expect(b.body.data).toHaveLength(1);
    // Each tenant gets its own B00001, never the other tenant's.
    expect(JSON.stringify(a.body.data)).toMatch(/Ann/);
    expect(JSON.stringify(a.body.data)).not.toMatch(/Bob/);
    expect(JSON.stringify(b.body.data)).toMatch(/Bob/);
    expect(JSON.stringify(b.body.data)).not.toMatch(/Ann/);
    const none = await callHandler(lookup, { body: { membershipNumbers: ["B00001"] } });
    expect(none.code).not.toBe(200);
  });

  test("3 email existence check is tenant-scoped and fails closed without a tenant", async () => {
    const cross = await callHandler(checkEmail, { tenantId: A, body: { email: "b1@example.test" } });
    expect(JSON.stringify(cross.body)).not.toMatch(/Bob|B00001/);
    const own = await callHandler(checkEmail, { tenantId: B, body: { email: "b1@example.test" } });
    expect(JSON.stringify(own.body)).toMatch(/B00001/);
    const spy = jest.spyOn(Profile, "findOne");
    const missing = await callHandler(checkEmail, { body: { email: "b1@example.test" } });
    expect(missing.code).toBe(401);
    expect(spy).not.toHaveBeenCalled(); // no cross-tenant query is ever issued
    spy.mockRestore();
  });

  test("4 DEV blocker: the legacy GLOBAL unique index membershipNumber_1 forbids the two-tenant case", async () => {
    const legacy = mongoose.connection.db.collection("legacy_profiles_probe");
    await legacy.createIndex({ membershipNumber: 1 }, { unique: true, name: "membershipNumber_1" });
    await legacy.insertOne({ tenantId: A, membershipNumber: "B00001" });
    await expect(legacy.insertOne({ tenantId: B, membershipNumber: "B00001" })).rejects.toThrow(/E11000/);
  });
});

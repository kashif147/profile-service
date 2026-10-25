const fs = require("fs");
const os = require("os");
const path = require("path");
const { ObjectId } = require("mongodb");
const rekey = require("../scripts/rekey-payment-form-encryption");

const OLD = "old-test-key-material-0123456789";
const NEW = "new-test-key-material-9876543210";
const IBAN = "IE29AIBK93115212345678";
const BIC = "AIBKIE2D";

function helperWith(rawKey) {
  jest.resetModules();
  process.env.PAYMENT_FORM_ENCRYPTION_KEY = rawKey;
  return require("../helpers/paymentFormCrypto");
}

function fakeCollection(docs) {
  const match = (doc, filter) =>
    Object.entries(filter).every(([k, v]) => {
      if (k === "$or") return v.some((f) => match(doc, f));
      const got = k.split(".").reduce((o, p) => (o == null ? undefined : o[p]), doc);
      return k === "_id" ? String(got) === String(v) : got === v;
    });
  return {
    docs,
    countDocuments: async () => docs.length,
    find: (filter) => ({ toArray: async () => docs.filter((d) => match(d, filter)).map((d) => JSON.parse(JSON.stringify(d))) }),
    findOne: async (filter) => JSON.parse(JSON.stringify(docs.find((d) => match(d, filter)) || null)),
    updateOne: async (filter, update) => {
      const d = docs.find((x) => match(x, filter));
      if (!d) return { modifiedCount: 0 };
      for (const [k, v] of Object.entries(update.$set)) {
        const parts = k.split(".");
        parts.slice(0, -1).reduce((o, p) => o[p], d)[parts[parts.length - 1]] = v;
      }
      return { modifiedCount: 1 };
    },
  };
}

function fakeMongoose(dbName, coll) {
  return { connection: { name: dbName, db: { collection: () => coll } }, Types: { ObjectId } };
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rekey-"));
  fs.writeFileSync(path.join(dir, "old"), OLD + "\n");
  fs.writeFileSync(path.join(dir, "new"), NEW);
  const h = helperWith(OLD);
  const form = {
    _id: new ObjectId(),
    tenantId: "t1",
    standingOrder: { debtorIban: h.encryptField(IBAN), debtorBic: h.encryptField(BIC) },
    directDebitMandate: { debtorIban: { value: null, encrypted: false }, debtorBic: { value: "PLAINBIC", encrypted: false } },
  };
  const other = { _id: new ObjectId(), tenantId: "t1", standingOrder: {}, directDebitMandate: {} };
  const coll = fakeCollection([form, other]);
  const env = { PAYMENT_FORM_OLD_KEY_FILE: path.join(dir, "old"), PAYMENT_FORM_NEW_KEY_FILE: path.join(dir, "new") };
  return { dir, coll, env, form, logs: [], log(m) { this.logs.push(m); } };
}

const DEV_DB = "profile-service-dev";

afterEach(() => {
  delete process.env.PAYMENT_FORM_ENCRYPTION_KEY;
});

describe("rekey-payment-form-encryption", () => {
  test("dry run plans the encrypted fields only and writes nothing", async () => {
    const s = setup();
    const before = JSON.stringify(s.coll.docs);
    const r = await rekey.run(["--target-env=dev"], { mongoose: fakeMongoose(DEV_DB, s.coll), env: s.env, log: (m) => s.logs.push(m) });
    expect(r).toEqual({ plans: 1, fields: 2, applied: 0 });
    expect(JSON.stringify(s.coll.docs)).toBe(before);
    expect(s.logs.join("\n")).toMatch(/plaintext=1/);
  });

  test("apply re-keys, the production helper decrypts with the NEW key only, plaintext field untouched", async () => {
    const s = setup();
    const rb = path.join(s.dir, "rollback.json");
    const r = await rekey.run(["--target-env=dev", "--apply", `--expect-db=${DEV_DB}`, `--rollback-file=${rb}`], { mongoose: fakeMongoose(DEV_DB, s.coll), env: s.env, log: () => {} });
    expect(r.applied).toBe(1);
    const stored = s.coll.docs[0];
    expect(helperWith(NEW).decryptField(stored.standingOrder.debtorIban)).toBe(IBAN);
    expect(helperWith(NEW).decryptField(stored.standingOrder.debtorBic)).toBe(BIC);
    expect(() => helperWith(OLD).decryptField(stored.standingOrder.debtorIban)).toThrow();
    expect(stored.directDebitMandate.debtorBic).toEqual({ value: "PLAINBIC", encrypted: false });
    expect(fs.statSync(rb).mode & 0o777).toBe(0o600);
  });

  test("a second run is a no-op (fields already under the new key)", async () => {
    const s = setup();
    const rb = path.join(s.dir, "rollback.json");
    const m = fakeMongoose(DEV_DB, s.coll);
    await rekey.run(["--apply", `--expect-db=${DEV_DB}`, `--rollback-file=${rb}`], { mongoose: m, env: s.env, log: () => {} });
    const logs = [];
    const r = await rekey.run([], { mongoose: m, env: s.env, log: (x) => logs.push(x) });
    expect(r.plans).toBe(0);
    expect(logs.join("\n")).toMatch(/already-new-key=2/);
  });

  test("rollback restores the original ciphertext, readable with the old key", async () => {
    const s = setup();
    const original = JSON.parse(JSON.stringify(s.coll.docs[0]));
    const rb = path.join(s.dir, "rollback.json");
    const m = fakeMongoose(DEV_DB, s.coll);
    await rekey.run(["--apply", `--expect-db=${DEV_DB}`, `--rollback-file=${rb}`], { mongoose: m, env: s.env, log: () => {} });
    const r = await rekey.run([`--rollback=${rb}`, `--expect-db=${DEV_DB}`], { mongoose: m, env: s.env, log: () => {} });
    expect(r.restored).toBe(1);
    expect(s.coll.docs[0].standingOrder).toEqual(original.standingOrder);
    expect(helperWith(OLD).decryptField(s.coll.docs[0].standingOrder.debtorIban)).toBe(IBAN);
  });

  test("a field that decrypts with neither key aborts before any write", async () => {
    const s = setup();
    s.coll.docs[0].standingOrder.debtorBic = helperWith("some-third-key-xxxxxxxxxxxxxxxx").encryptField(BIC);
    const before = JSON.stringify(s.coll.docs);
    await expect(rekey.run(["--apply", `--expect-db=${DEV_DB}`, `--rollback-file=${path.join(s.dir, "rb.json")}`], { mongoose: fakeMongoose(DEV_DB, s.coll), env: s.env, log: () => {} })).rejects.toThrow(/neither the old nor the new key/);
    expect(JSON.stringify(s.coll.docs)).toBe(before);
    expect(fs.existsSync(path.join(s.dir, "rb.json"))).toBe(false);
  });

  test("a concurrent change makes the guarded update match nothing and the run stop", async () => {
    const s = setup();
    const coll = s.coll;
    const orig = coll.updateOne;
    coll.updateOne = async (f, u) => {
      coll.docs[0].standingOrder.debtorIban = helperWith(OLD).encryptField(IBAN);
      return orig(f, u);
    };
    await expect(rekey.run(["--apply", `--expect-db=${DEV_DB}`, `--rollback-file=${path.join(s.dir, "rb.json")}`], { mongoose: fakeMongoose(DEV_DB, coll), env: s.env, log: () => {} })).rejects.toThrow(/changed concurrently/);
  });

  test("apply needs --expect-db and --rollback-file; an existing rollback file is never overwritten", async () => {
    const s = setup();
    const m = fakeMongoose(DEV_DB, s.coll);
    await expect(rekey.run(["--apply"], { mongoose: m, env: s.env, log: () => {} })).rejects.toThrow(/--expect-db/);
    await expect(rekey.run(["--apply", `--expect-db=${DEV_DB}`], { mongoose: m, env: s.env, log: () => {} })).rejects.toThrow(/--rollback-file/);
    const rb = path.join(s.dir, "exists.json");
    fs.writeFileSync(rb, "{}");
    await expect(rekey.run(["--apply", `--expect-db=${DEV_DB}`, `--rollback-file=${rb}`], { mongoose: m, env: s.env, log: () => {} })).rejects.toThrow(/EEXIST/);
  });

  test("db guard refuses a non-approved database and identical keys are refused", async () => {
    const s = setup();
    await expect(rekey.run([], { mongoose: fakeMongoose("Profile-Service", s.coll), env: s.env, log: () => {} })).rejects.toThrow(/db-guard/);
    fs.writeFileSync(s.env.PAYMENT_FORM_NEW_KEY_FILE, OLD);
    await expect(rekey.run([], { mongoose: fakeMongoose(DEV_DB, s.coll), env: s.env, log: () => {} })).rejects.toThrow(/identical/);
  });

  test("output never contains plaintext, ciphertext or key material", async () => {
    const s = setup();
    const logs = [];
    const rb = path.join(s.dir, "rollback.json");
    await rekey.run(["--apply", `--expect-db=${DEV_DB}`, `--rollback-file=${rb}`], { mongoose: fakeMongoose(DEV_DB, s.coll), env: s.env, log: (x) => logs.push(x) });
    const out = logs.join("\n");
    for (const secret of [IBAN, BIC, OLD, NEW, s.coll.docs[0].standingOrder.debtorIban.value]) expect(out).not.toContain(secret);
  });
});

/**
 * One-off re-key of payment-form IBAN/BIC ciphertext (helpers/paymentFormCrypto.js, AES-256-GCM,
 * key = sha256(PAYMENT_FORM_ENCRYPTION_KEY)) from the current key to a new one, so an environment
 * can stop sharing PAYMENT_FORM_ENCRYPTION_KEY with another.
 *
 * Fields: standingOrder.debtorIban/debtorBic and directDebitMandate.debtorIban/debtorBic
 * ({ value, encrypted }). Only fields with encrypted === true are touched; plaintext fields
 * (encrypted === false, written while no key was configured) are counted and left alone.
 *
 * Keys are read from FILES, never from argv or the service env (argv is visible in `ps`):
 *   PAYMENT_FORM_OLD_KEY_FILE   raw key currently in use (what PAYMENT_FORM_ENCRYPTION_KEY holds)
 *   PAYMENT_FORM_NEW_KEY_FILE   raw new key (what PAYMENT_FORM_ENCRYPTION_KEY will hold afterwards)
 * Trailing newlines are stripped, exactly like a value in an env file.
 *
 * Per field:  decrypt(old) must succeed -> encrypt(new) -> decrypt(new) must equal the plaintext.
 * A field that already decrypts with the NEW key (and not the old) is reported as already re-keyed
 * and skipped, so a re-run is a no-op. A field that decrypts with neither key aborts the run.
 *
 * DRY-RUN BY DEFAULT: performs every decrypt/encrypt/verify in memory and writes nothing.
 * --apply additionally requires --expect-db=<name> (db guard) and --rollback-file=<path>:
 *   1. the rollback file (mode 0600, must not exist) is written FIRST with, per changed form,
 *      the _id and the previous and new ciphertext of every changed field;
 *   2. each form is updated with a filter on its exact previous ciphertext (a concurrent write
 *      makes the update match nothing and the run stop);
 *   3. each form is re-read and every field must decrypt with the new key to the same plaintext.
 * --rollback=<path> restores the previous ciphertext from such a file, only where the stored
 * value is still exactly the recorded new ciphertext (also needs --expect-db).
 *
 * Output: counts, form ids and field names only. Plaintext, ciphertext and keys are never printed.
 *
 * Usage (profile-service's own database only):
 *   MONGO_URI=... PAYMENT_FORM_OLD_KEY_FILE=... PAYMENT_FORM_NEW_KEY_FILE=... \
 *     node scripts/rekey-payment-form-encryption.js --target-env=uat                     # dry run
 *   ... --target-env=uat --apply --expect-db=<db> --rollback-file=<path>                  # write
 *   ... --target-env=uat --rollback=<path> --expect-db=<db>                               # undo
 * UAT targets also need DEPLOYMENT_ENV=uat (scripts/lib/migrationTargetGuard.js).
 */
const crypto = require("crypto");
const fs = require("fs");

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const FIELDS = [
  "standingOrder.debtorIban",
  "standingOrder.debtorBic",
  "directDebitMandate.debtorIban",
  "directDebitMandate.debtorBic",
];

function deriveKey(raw) {
  if (!raw) throw new Error("empty key");
  return crypto.createHash("sha256").update(raw).digest();
}

function readKeyFile(path, label) {
  if (!path) throw new Error(`${label} is required`);
  const raw = fs.readFileSync(path, "utf8").replace(/\r?\n+$/, "");
  if (!raw) throw new Error(`${label} is empty`);
  return raw;
}

function encryptWith(key, plain) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

/** Plaintext, or null when the GCM tag does not verify under `key`. */
function tryDecryptWith(key, payload) {
  try {
    const buf = Buffer.from(String(payload), "base64");
    if (buf.length < IV_LEN + TAG_LEN) return null;
    const decipher = crypto.createDecipheriv(ALGO, key, buf.subarray(0, IV_LEN));
    decipher.setAuthTag(buf.subarray(IV_LEN, IV_LEN + TAG_LEN));
    return Buffer.concat([decipher.update(buf.subarray(IV_LEN + TAG_LEN)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function getPath(doc, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), doc);
}

/**
 * Pure re-key plan for one form. Returns { changes: [{ field, from, to }], skipped: {...} }.
 * Throws when a field decrypts with neither key or the round trip fails.
 */
function planForm(doc, oldKey, newKey) {
  const changes = [];
  const skipped = { empty: 0, plaintext: 0, alreadyNewKey: 0 };
  for (const field of FIELDS) {
    const stored = getPath(doc, field);
    if (!stored || stored.value == null || stored.value === "") {
      skipped.empty++;
      continue;
    }
    if (stored.encrypted !== true) {
      skipped.plaintext++;
      continue;
    }
    const plain = tryDecryptWith(oldKey, stored.value);
    if (plain == null) {
      if (tryDecryptWith(newKey, stored.value) != null) {
        skipped.alreadyNewKey++;
        continue;
      }
      throw new Error(`form ${doc._id}: ${field} decrypts with neither the old nor the new key`);
    }
    const to = encryptWith(newKey, plain);
    if (tryDecryptWith(newKey, to) !== plain || tryDecryptWith(oldKey, to) != null) {
      throw new Error(`form ${doc._id}: ${field} new-key round trip failed`);
    }
    changes.push({ field, from: stored.value, to });
  }
  return { changes, skipped };
}

const ENCRYPTED_FILTER = { $or: FIELDS.map((f) => ({ [`${f}.encrypted`]: true })) };

async function run(argv, { mongoose, env = process.env, log = console.log }) {
  const { assertMigrationTarget } = require("./lib/migrationTargetGuard");
  const apply = argv.includes("--apply");
  const arg = (k) => (argv.find((a) => a.startsWith(`--${k}=`)) || "").slice(k.length + 3);
  const rollbackFrom = arg("rollback");
  const rollbackFile = arg("rollback-file");
  const writes = apply || !!rollbackFrom;
  if (apply && rollbackFrom) throw new Error("--apply and --rollback are mutually exclusive");

  assertMigrationTarget(mongoose.connection.name, argv, { apply: writes });
  const forms = mongoose.connection.db.collection("memberpaymentforms");

  if (rollbackFrom) {
    const rec = JSON.parse(fs.readFileSync(rollbackFrom, "utf8"));
    let restored = 0;
    for (const f of rec.forms) {
      const filter = { _id: new mongoose.Types.ObjectId(f.id) };
      const set = {};
      for (const c of f.changes) {
        filter[`${c.field}.value`] = c.to;
        set[`${c.field}.value`] = c.from;
      }
      const r = await forms.updateOne(filter, { $set: set });
      log(`[rekey] rollback form ${f.id}: ${r.modifiedCount === 1 ? "restored" : "NOT restored (stored value changed)"}`);
      restored += r.modifiedCount;
    }
    log(`[rekey] rollback: ${restored}/${rec.forms.length} form(s) restored`);
    return { restored };
  }

  const oldKey = deriveKey(readKeyFile(env.PAYMENT_FORM_OLD_KEY_FILE, "PAYMENT_FORM_OLD_KEY_FILE"));
  const newKey = deriveKey(readKeyFile(env.PAYMENT_FORM_NEW_KEY_FILE, "PAYMENT_FORM_NEW_KEY_FILE"));
  if (oldKey.equals(newKey)) throw new Error("old and new keys are identical");

  const total = await forms.countDocuments({});
  const docs = await forms.find(ENCRYPTED_FILTER).toArray();
  const plans = [];
  const sk = { empty: 0, plaintext: 0, alreadyNewKey: 0 };
  for (const doc of docs) {
    const p = planForm(doc, oldKey, newKey);
    for (const k of Object.keys(sk)) sk[k] += p.skipped[k];
    if (p.changes.length) plans.push({ id: String(doc._id), changes: p.changes });
  }
  const fields = plans.reduce((n, p) => n + p.changes.length, 0);
  log(`[rekey] forms total=${total} with encrypted fields=${docs.length} to re-key=${plans.length} fields=${fields} ` +
    `(skipped: plaintext=${sk.plaintext} already-new-key=${sk.alreadyNewKey})`);
  for (const p of plans) log(`[rekey]   form ${p.id}: ${p.changes.map((c) => c.field).join(", ")}`);
  if (!apply) {
    log("[rekey] DRY-RUN: every field decrypted with the old key and round-tripped under the new key; nothing written");
    return { plans: plans.length, fields, applied: 0 };
  }

  if (!rollbackFile) throw new Error("--apply requires --rollback-file=<path>");
  fs.writeFileSync(rollbackFile, JSON.stringify({ at: new Date().toISOString(), db: mongoose.connection.name, forms: plans }), { mode: 0o600, flag: "wx" });
  log(`[rekey] rollback record written (${plans.length} form(s))`);

  let applied = 0;
  for (const p of plans) {
    const filter = { _id: new mongoose.Types.ObjectId(p.id) };
    const set = {};
    for (const c of p.changes) {
      filter[`${c.field}.value`] = c.from;
      set[`${c.field}.value`] = c.to;
    }
    const r = await forms.updateOne(filter, { $set: set });
    if (r.modifiedCount !== 1) throw new Error(`form ${p.id}: changed concurrently, stopped after ${applied} form(s)`);
    const after = await forms.findOne({ _id: filter._id });
    for (const c of p.changes) {
      const plainBefore = tryDecryptWith(oldKey, c.from);
      if (tryDecryptWith(newKey, getPath(after, c.field).value) !== plainBefore) {
        throw new Error(`form ${p.id}: ${c.field} failed post-write verification`);
      }
    }
    applied++;
    log(`[rekey] form ${p.id}: re-keyed and verified`);
  }
  log(`[rekey] APPLY done: ${applied}/${plans.length} form(s) re-keyed; now set PAYMENT_FORM_ENCRYPTION_KEY to the new key`);
  return { plans: plans.length, fields, applied };
}

if (require.main === module) {
  const mongoose = require("mongoose");
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  (async () => {
    if (!uri) throw new Error("MONGO_URI (or MONGODB_URI) is required");
    await mongoose.connect(uri);
    try {
      await run(process.argv.slice(2), { mongoose });
    } finally {
      await mongoose.disconnect();
    }
  })().catch((e) => {
    console.error(`[rekey] FAILED: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { FIELDS, deriveKey, readKeyFile, encryptWith, tryDecryptWith, planForm, run };

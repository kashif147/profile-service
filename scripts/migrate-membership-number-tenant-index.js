/**
 * Migration (Phase 2B-PARALLEL-2, B5 / audit M2): membership numbers unique per tenant.
 *
 * Membership numbers are now issued from a per-tenant sequence
 * (helpers/membership.number.generator.js + MembershipNumberSequence). Existing numbers
 * are kept exactly as they are; nothing is renumbered.
 *
 * Steps (separate invocations; nothing is written without --apply):
 *   --report (default)   aggregate counts: profiles with a number, per tenant class,
 *                        numbers without a tenant, duplicate numbers within a tenant
 *                        (must be 0), numbers shared across tenants (informational),
 *                        current indexes, highest sequence per tenant/letter.
 *   --create-index       build { tenantId, membershipNumber } unique (partial on string).
 *   --seed-counters      seed MembershipNumberSequence from each tenant's current max
 *                        ($max, idempotent). Optional: the generator seeds lazily too.
 *   --drop-legacy-index  drop the global membershipNumber_1 unique index, only when the
 *                        tenant index exists and no numbered profile lacks a tenant.
 *
 * Until --drop-legacy-index runs, two tenants still cannot hold the same number (the old
 * global index rejects it): safe, and irrelevant while only one tenant exists.
 * Rollback: the new index and counters are additive; recreating membershipNumber_1 works
 * only while no number is shared across tenants.
 *
 *   MONGO_URI=... node scripts/migrate-membership-number-tenant-index.js --report
 *   MONGO_URI=... node scripts/migrate-membership-number-tenant-index.js --create-index --apply
 *
 * Connects only to profile-service's own database. Raw driver; prints no member data.
 */
const mongoose = require("mongoose");
const { assertMigrationTarget } = require("./lib/migrationTargetGuard");

const LEGACY_INDEX = "membershipNumber_1";
const NEW_INDEX = "tenantId_1_membershipNumber_1";
const HAS_NUMBER = { membershipNumber: { $type: "string", $ne: "" } };
const NO_TENANT = { $or: [{ tenantId: { $exists: false } }, { tenantId: null }, { tenantId: "" }] };

function parseArgs(argv) {
  const out = { mode: "report", apply: argv.includes("--apply") };
  if (argv.includes("--create-index")) out.mode = "create-index";
  if (argv.includes("--seed-counters")) out.mode = "seed-counters";
  if (argv.includes("--drop-legacy-index")) out.mode = "drop-legacy-index";
  return out;
}

async function report(db) {
  const profiles = db.collection("profiles");
  const numbered = await profiles.countDocuments(HAS_NUMBER);
  const numberedNoTenant = await profiles.countDocuments({ $and: [HAS_NUMBER, NO_TENANT] });
  const perTenant = await profiles
    .aggregate([{ $match: HAS_NUMBER }, { $group: { _id: "$tenantId", n: { $sum: 1 } } }])
    .toArray();
  const dupWithinTenant = await profiles
    .aggregate([
      { $match: HAS_NUMBER },
      { $group: { _id: { t: "$tenantId", m: "$membershipNumber" }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $count: "groups" },
    ])
    .toArray();
  const sharedAcrossTenants = await profiles
    .aggregate([
      { $match: HAS_NUMBER },
      { $group: { _id: "$membershipNumber", tenants: { $addToSet: "$tenantId" } } },
      { $match: { "tenants.1": { $exists: true } } },
      { $count: "numbers" },
    ])
    .toArray();
  const maxPerTenantLetter = await profiles
    .aggregate([
      { $match: { membershipNumber: { $regex: /^[A-Z]\d+$/ } } },
      {
        $group: {
          _id: { t: "$tenantId", letter: { $substrCP: ["$membershipNumber", 0, 1] } },
          maxNumber: { $max: "$membershipNumber" },
          n: { $sum: 1 },
        },
      },
    ])
    .toArray();
  const nonStandardFormat = await profiles.countDocuments({
    $and: [HAS_NUMBER, { membershipNumber: { $not: /^[A-Z]\d{5,}$/ } }],
  });
  const indexes = (await profiles.indexes()).map((i) => `${i.name}${i.unique ? "(unique)" : ""}`);
  return {
    numberedProfiles: numbered,
    numberedWithoutTenant: numberedNoTenant,
    numberedPerTenant: Object.fromEntries(perTenant.map((r) => [String(r._id ?? "<none>"), r.n])),
    duplicateGroupsWithinTenant: dupWithinTenant[0]?.groups || 0,
    numbersSharedAcrossTenants: sharedAcrossTenants[0]?.numbers || 0,
    nonStandardFormatNumbers: nonStandardFormat,
    highestSequencePerTenantLetter: maxPerTenantLetter.map((r) => ({
      tenant: String(r._id.t ?? "<none>"),
      letter: r._id.letter,
      highestSequence: parseInt(String(r.maxNumber).slice(1), 10),
      count: r.n,
    })),
    indexes,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI (profile-service's own DB) is required");
  await mongoose.connect(uri, { autoIndex: false });
  const db = mongoose.connection.db;
  try {
    assertMigrationTarget(mongoose.connection.name, process.argv.slice(2), { apply: args.apply });
    const before = await report(db);
    const out = { mode: args.mode, apply: args.apply, report: before };
    const profiles = db.collection("profiles");

    if (args.mode === "create-index") {
      if (before.duplicateGroupsWithinTenant > 0) {
        throw new Error("refusing: duplicate membership numbers within a tenant");
      }
      const present = (await profiles.indexes()).some((i) => i.name === NEW_INDEX);
      out.result = present ? "present" : args.apply ? "created" : "would-create";
      if (!present && args.apply) {
        await profiles.createIndex(
          { tenantId: 1, membershipNumber: 1 },
          {
            unique: true,
            name: NEW_INDEX,
            partialFilterExpression: { membershipNumber: { $type: "string" } },
          },
        );
      }
    }

    if (args.mode === "seed-counters") {
      const seqs = db.collection("membershipnumbersequences");
      out.result = [];
      for (const r of before.highestSequencePerTenantLetter) {
        if (r.tenant === "<none>" || !Number.isFinite(r.highestSequence)) continue;
        out.result.push({ tenant: r.tenant, letter: r.letter, seedTo: r.highestSequence });
        if (args.apply) {
          await seqs.updateOne(
            { tenantId: r.tenant, yearAlphabet: r.letter },
            { $max: { seq: r.highestSequence }, $setOnInsert: { createdAt: new Date() } },
            { upsert: true },
          );
        }
      }
    }

    if (args.mode === "drop-legacy-index") {
      const idx = await profiles.indexes();
      const replacement = idx.find((i) => i.name === NEW_INDEX);
      const legacy = idx.find((i) => i.name === LEGACY_INDEX);
      if (!legacy) out.result = "no-legacy-index";
      else if (!replacement || !replacement.unique || before.numberedWithoutTenant > 0) {
        throw new Error(
          `refusing: replacement=${replacement ? "present" : "missing"}, numberedWithoutTenant=${before.numberedWithoutTenant}`,
        );
      } else {
        out.result = args.apply ? `dropped ${LEGACY_INDEX}` : `would-drop ${LEGACY_INDEX}`;
        if (args.apply) await profiles.dropIndex(LEGACY_INDEX);
      }
    }

    if (args.mode !== "report" && !args.apply) out.note = "DRY-RUN: nothing was written. Re-run with --apply.";
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Migration failed:", err.message);
    process.exit(1);
  });
}

module.exports = { parseArgs };

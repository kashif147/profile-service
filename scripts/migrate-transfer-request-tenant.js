/**
 * Migration (Phase 2B, C-04): re-tenant existing TransferRequest rows.
 *
 * Before Phase 2B, TransferRequest.tenantId defaulted to a hardcoded tenant id
 * and was never stamped from the request, so every existing row may carry the
 * wrong tenant. The authoritative tenant of a transfer request is the tenant of
 * the Profile it references (profileId -> Profile.tenantId).
 *
 * DRY-RUN BY DEFAULT. Nothing is written unless --apply is passed. A dry run
 * prints aggregate counts only (add --verbose for per-row lines). With --apply
 * every change is printed as "<id>: <old> -> <new>": keep that output, it is
 * the rollback record (set each id back to its old tenantId).
 *
 * Usage:
 *   MONGO_URI=... node scripts/migrate-transfer-request-tenant.js           # dry run
 *   MONGO_URI=... node scripts/migrate-transfer-request-tenant.js --apply   # write
 *
 * Connects only to profile-service's own database (MONGO_URI / MONGODB_URI).
 * Rows whose profile is missing or has no tenantId are reported, never guessed.
 */
const mongoose = require("mongoose");
const { assertMigrationTarget } = require("./lib/migrationTargetGuard");
require("dotenv").config();

const APPLY = process.argv.includes("--apply");
const VERBOSE = APPLY || process.argv.includes("--verbose");
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

async function main() {
  if (!MONGO_URI) {
    console.error("MONGO_URI (or MONGODB_URI) is required");
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
  assertMigrationTarget(mongoose.connection.name, process.argv.slice(2), { apply: APPLY });
  const db = mongoose.connection.db;
  const transfers = db.collection("transferrequests");
  const profiles = db.collection("profiles");

  const summary = { scanned: 0, unchanged: 0, retenanted: 0, missingProfile: 0, profileWithoutTenant: 0 };
  const problems = [];
  const transitions = {}; // "<old tenant> -> <new tenant>": count

  const cursor = transfers.find({}, { projection: { _id: 1, profileId: 1, tenantId: 1 } });
  for await (const row of cursor) {
    summary.scanned += 1;
    const profile = row.profileId
      ? await profiles.findOne({ _id: row.profileId }, { projection: { tenantId: 1 } })
      : null;
    if (!profile) {
      summary.missingProfile += 1;
      problems.push({ transferRequestId: String(row._id), reason: "profile_not_found" });
      continue;
    }
    const profileTenant = profile.tenantId != null ? String(profile.tenantId).trim() : "";
    if (!profileTenant) {
      summary.profileWithoutTenant += 1;
      problems.push({ transferRequestId: String(row._id), reason: "profile_has_no_tenant" });
      continue;
    }
    if (String(row.tenantId || "") === profileTenant) {
      summary.unchanged += 1;
      continue;
    }
    summary.retenanted += 1;
    const t = `${row.tenantId || "<none>"} -> ${profileTenant}`;
    transitions[t] = (transitions[t] || 0) + 1;
    if (VERBOSE) {
      console.log(`${APPLY ? "UPDATE" : "WOULD UPDATE"} transferRequest ${row._id}: ${t}`);
    }
    if (APPLY) {
      await transfers.updateOne(
        { _id: row._id, tenantId: row.tenantId },
        { $set: { tenantId: profileTenant } },
      );
    }
  }

  console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", summary, transitions }, null, 2));
  if (problems.length && VERBOSE) {
    console.log("Rows needing manual review (left untouched):");
    console.log(JSON.stringify(problems, null, 2));
  }
  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error("Migration failed:", err.message);
  try {
    await mongoose.connection.close();
  } catch (_e) {}
  process.exit(1);
});

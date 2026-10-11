/**
 * Backfill (Phase 2B, H-08): stamp tenantId on existing Batch (cohort snapshot)
 * documents. Batch had no tenantId before Phase 2B; every batch query is now
 * tenant-scoped, so un-backfilled batches become invisible (fail closed).
 *
 * Tenant resolution per batch, in order:
 *   1. The tenantId shared by ALL profiles in batch.profileIds (profile-service DB).
 *   2. If the batch has no profiles: the tenant of the creating CRM user
 *      (users collection, userId === batch.createdBy) when exactly one exists.
 * A batch whose profiles span several tenants (created by the old unscoped
 * query) is reported as MIXED and left untouched — it needs a manual split /
 * delete decision, and its Profile.batchId links should be reviewed.
 *
 * DRY-RUN BY DEFAULT. Nothing is written unless --apply is passed.
 *
 * Usage:
 *   MONGO_URI=... node scripts/backfill-batch-tenant.js           # dry run
 *   MONGO_URI=... node scripts/backfill-batch-tenant.js --apply   # write
 *
 * Connects only to profile-service's own database.
 */
const mongoose = require("mongoose");
require("dotenv").config();

const APPLY = process.argv.includes("--apply");
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

async function main() {
  if (!MONGO_URI) {
    console.error("MONGO_URI (or MONGODB_URI) is required");
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  const batches = db.collection("batches");
  const profiles = db.collection("profiles");
  const users = db.collection("users");

  const summary = { scanned: 0, alreadyTenanted: 0, stamped: 0, mixed: 0, unresolved: 0 };
  const problems = [];

  const cursor = batches.find(
    { $or: [{ tenantId: { $exists: false } }, { tenantId: null }, { tenantId: "" }] },
    { projection: { _id: 1, profileIds: 1, createdBy: 1, tenantId: 1 } },
  );
  for await (const batch of cursor) {
    summary.scanned += 1;
    const ids = Array.isArray(batch.profileIds) ? batch.profileIds : [];
    let tenantId = null;

    if (ids.length) {
      const tenants = await profiles.distinct("tenantId", { _id: { $in: ids } });
      const clean = tenants.filter((t) => t != null && String(t).trim());
      if (clean.length > 1) {
        summary.mixed += 1;
        problems.push({ batchId: String(batch._id), reason: "mixed_tenants", tenants: clean.map(String) });
        continue;
      }
      if (clean.length === 1) tenantId = String(clean[0]);
    }

    if (!tenantId && batch.createdBy) {
      const creatorTenants = await users.distinct("tenantId", {
        userId: String(batch.createdBy),
        userType: "CRM",
      });
      const clean = creatorTenants.filter((t) => t != null && String(t).trim());
      if (clean.length === 1) tenantId = String(clean[0]);
    }

    if (!tenantId) {
      summary.unresolved += 1;
      problems.push({ batchId: String(batch._id), reason: "tenant_unresolved" });
      continue;
    }

    summary.stamped += 1;
    console.log(`${APPLY ? "UPDATE" : "WOULD UPDATE"} batch ${batch._id} -> tenantId ${tenantId}`);
    if (APPLY) {
      await batches.updateOne(
        { _id: batch._id, $or: [{ tenantId: { $exists: false } }, { tenantId: null }, { tenantId: "" }] },
        { $set: { tenantId } },
      );
    }
  }

  summary.alreadyTenanted = await batches.countDocuments({ tenantId: { $nin: [null, ""], $exists: true } });
  console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", summary }, null, 2));
  if (problems.length) {
    console.log("Batches needing manual review (left untouched):");
    console.log(JSON.stringify(problems, null, 2));
  }
  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error("Backfill failed:", err.message);
  try {
    await mongoose.connection.close();
  } catch (_e) {}
  process.exit(1);
});

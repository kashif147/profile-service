/**
 * P5: explicit operation idempotency for duplicate-review decisions (replaces the body-hash
 * idempotency() middleware on POST /applications/:id/duplicate-review).
 *
 * - The client supplies an operation key (Idempotency-Key header). Without one, nothing is cached:
 *   every request is a new decision, protected by the review-version compare-and-set.
 * - Identical retry (same key, same payload) returns the original result - but only while the
 *   review is still at the version that result produced. If the review has changed since (a later
 *   decision, or a detection run that invalidated it), the replay gets 409 REVIEW_VERSION_CONFLICT:
 *   a cached success can never imply that the current review is still resolved.
 * - Same key with a different payload -> 422 IDEMPOTENCY_KEY_REUSED. Same key while the first
 *   request is still running -> 409 IDEMPOTENCY_IN_FLIGHT.
 *
 * The store is per process (as the middleware it replaces); correctness does not depend on it,
 * because every replay is re-validated against the database and every write is version-checked.
 */
const crypto = require("crypto");

const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 5000;
const store = new Map();

function operationKey({ tenantId, reviewerId, applicationId, key }) {
  return `${tenantId}|${reviewerId}|${applicationId}|${key}`;
}

function payloadHash(body) {
  const b = body || {};
  const canonical = [
    b.action ?? null,
    b.sourceType ?? null,
    b.sourceId ?? null,
    b.decisionReason ?? null,
    b.mergeFieldChoices ? Object.keys(b.mergeFieldChoices).sort().map((k) => [k, b.mergeFieldChoices[k]]) : null,
    b.expectedReviewVersion ?? null,
  ];
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function sweep(now) {
  if (store.size < MAX_ENTRIES) return;
  for (const [k, v] of store) {
    if (now - v.at > TTL_MS) store.delete(k);
  }
}

/**
 * @returns {{ kind: "execute" } | { kind: "replay", entry } | { kind: "error", error }}
 */
function begin(opKey, hash, now = Date.now()) {
  const existing = store.get(opKey);
  if (existing && now - existing.at <= TTL_MS) {
    if (existing.hash !== hash) return { kind: "reused" };
    if (existing.state === "in_flight") return { kind: "in_flight" };
    return { kind: "replay", entry: existing };
  }
  sweep(now);
  store.set(opKey, { hash, state: "in_flight", at: now });
  return { kind: "execute" };
}

function complete(opKey, hash, response, resultVersion) {
  store.set(opKey, { hash, state: "done", response, resultVersion, at: Date.now() });
}

function abandon(opKey) {
  store.delete(opKey);
}

function _reset() {
  store.clear();
}

module.exports = { operationKey, payloadHash, begin, complete, abandon, TTL_MS, _reset };

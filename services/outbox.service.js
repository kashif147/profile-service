// Outbox relay (account-service docs/design/IMPLEMENTATION_PLAN.md s.5.4): enqueue() records
// an event next to the state change; the relay publishes PENDING rows with exponential backoff
// (1 s .. 15 min, error log after 24 h). Single-instance assumption like the other in-process
// jobs; a second instance only causes duplicate publishes, which consumers dedupe on
// data.eventKey.
const OutboxEvent = require("../models/outboxEvent.model.js");

const MAX_BACKOFF_MS = 15 * 60 * 1000;
const ALERT_AFTER_MS = 24 * 3600 * 1000;

let publishFn = null;
function defaultPublish(routingKey, data, meta) {
  const { publishDomainEvent } = require("../rabbitMQ/index.js");
  return publishDomainEvent(routingKey, data, meta);
}
/** Test seam. */
function setOutboxPublisher(fn) {
  publishFn = fn;
}

async function enqueueOutboxEvent({ eventKey, tenantId, routingKey, data, correlationId }) {
  if (!eventKey || !tenantId || !routingKey) {
    throw new Error("enqueueOutboxEvent: eventKey, tenantId and routingKey are required");
  }
  const res = await OutboxEvent.updateOne(
    { eventKey },
    {
      $setOnInsert: {
        eventKey,
        tenantId: String(tenantId),
        routingKey,
        data: { ...data, eventKey },
        correlationId: correlationId || eventKey,
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: new Date(),
      },
    },
    { upsert: true }
  );
  return { created: Boolean(res.upsertedCount) };
}

function backoffMs(attempts) {
  return Math.min(1000 * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

async function relayOutboxOnce({ now = new Date(), limit = 50 } = {}) {
  const publish = publishFn || defaultPublish;
  const due = await OutboxEvent.find({ status: "PENDING", nextAttemptAt: { $lte: now } })
    .sort({ nextAttemptAt: 1 })
    .limit(limit)
    .lean();
  let published = 0;
  let failed = 0;
  for (const row of due) {
    let ok = false;
    let error = null;
    try {
      ok = await publish(row.routingKey, row.data, {
        tenantId: row.tenantId,
        correlationId: row.correlationId,
        eventKey: row.eventKey,
      });
    } catch (err) {
      error = err.message;
    }
    if (ok) {
      published += 1;
      await OutboxEvent.updateOne(
        { _id: row._id, status: "PENDING" },
        { $set: { status: "PUBLISHED", publishedAt: new Date() }, $inc: { attempts: 1 } }
      );
    } else {
      failed += 1;
      const attempts = (row.attempts || 0) + 1;
      await OutboxEvent.updateOne(
        { _id: row._id },
        {
          $set: {
            nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
            lastError: error || "publish returned false",
          },
          $inc: { attempts: 1 },
        }
      );
      if (now - new Date(row.createdAt) > ALERT_AFTER_MS) {
        console.error("[outbox] event undelivered for over 24h", {
          eventKey: row.eventKey,
          routingKey: row.routingKey,
          attempts,
        });
      }
    }
  }
  return { due: due.length, published, failed };
}

let timer = null;
let stopped = true;
function startOutboxRelay({ intervalMs = Number(process.env.OUTBOX_RELAY_INTERVAL_MS || 2000) } = {}) {
  if (!stopped) return;
  stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await relayOutboxOnce();
    } catch (err) {
      console.warn("[outbox] relay tick failed", { name: err?.name, code: err?.code ?? null });
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, intervalMs);
}
function stopOutboxRelay() {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = {
  enqueueOutboxEvent,
  relayOutboxOnce,
  startOutboxRelay,
  stopOutboxRelay,
  setOutboxPublisher,
};

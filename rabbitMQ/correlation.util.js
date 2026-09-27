"use strict";

const crypto = require("crypto");

/**
 * Resolve the trace correlationId for work triggered by a consumed message.
 *
 * Preserve the inbound message's correlationId when present so a single trace
 * spans service boundaries; only start a NEW trace (fresh UUID) when the inbound
 * message genuinely carries none.
 *
 * @param {{ correlationId?: string }} [payload] the consumed RabbitMQ envelope
 * @returns {string}
 */
function resolveCorrelationId(payload) {
  const inbound = payload && payload.correlationId;
  return typeof inbound === "string" && inbound.length > 0
    ? inbound
    : crypto.randomUUID();
}

module.exports = { resolveCorrelationId };

"use strict";
// Focused unit tests for RabbitMQ inbound-correlation preservation.
// Run: node --test test/correlation.util.test.js
const test = require("node:test");
const assert = require("node:assert");
const { resolveCorrelationId } = require("../rabbitMQ/correlation.util.js");

test("preserves inbound correlationId when present", () => {
  assert.equal(resolveCorrelationId({ correlationId: "trace-123" }), "trace-123");
});

test("generates a new id only when inbound correlationId is absent", () => {
  const a = resolveCorrelationId({});
  const b = resolveCorrelationId(undefined);
  const c = resolveCorrelationId({ correlationId: "" });
  for (const v of [a, b, c]) {
    assert.equal(typeof v, "string");
    assert.ok(v.length >= 8, "looks like a generated id");
  }
  assert.notEqual(a, b, "distinct fresh ids");
});

test("non-string inbound correlationId is treated as absent", () => {
  const v = resolveCorrelationId({ correlationId: 12345 });
  assert.equal(typeof v, "string");
  assert.notEqual(v, "12345");
});

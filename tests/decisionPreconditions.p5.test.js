"use strict";
/**
 * P5: DUPLICATE_REVIEW_VERSION_MODE preconditions and the approval payment-binding rule (pure units;
 * the end-to-end proofs are in duplicateReviewOwnership.p5.test.js on a real replica set).
 */
const pre = require("../services/decisionPreconditions.js");
const { assertApprovalPaymentBinding } = require("../services/approvalPaymentBinding.js");

const MODE = pre.MODE_ENV;
let saved;
beforeEach(() => {
  saved = process.env[MODE];
  delete process.env[MODE];
  pre._resetWarnings();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  if (saved === undefined) delete process.env[MODE];
  else process.env[MODE] = saved;
  jest.restoreAllMocks();
});

const req = (key) => ({ headers: key === undefined ? {} : { "idempotency-key": key } });

describe("mode", () => {
  test.each([
    [undefined, "compat"],
    ["", "compat"],
    ["compat", "compat"],
    ["enforce", "enforce"],
    [" ENFORCE ", "enforce"],
    ["enforced", "compat"],
    ["true", "compat"],
  ])("%p -> %s", (value, expected) => {
    if (value !== undefined) process.env[MODE] = value;
    expect(pre.reviewVersionMode()).toBe(expected);
  });

  test("an unrecognised value is warned about once", () => {
    process.env[MODE] = "strict";
    pre.reviewVersionMode();
    pre.reviewVersionMode();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

describe("Idempotency-Key", () => {
  test("compat: absent -> null; present -> trimmed key", () => {
    expect(pre.readIdempotencyKey(req())).toBeNull();
    expect(pre.readIdempotencyKey(req("  "))).toBeNull();
    expect(pre.readIdempotencyKey(req(" 6f1c-uuid "))).toBe("6f1c-uuid");
  });
  test("enforce: absent -> 428 IDEMPOTENCY_KEY_REQUIRED", () => {
    process.env[MODE] = "enforce";
    expect(() => pre.readIdempotencyKey(req())).toThrow(expect.objectContaining({ status: 428, code: "IDEMPOTENCY_KEY_REQUIRED" }));
  });
  test.each(["has space", "x".repeat(201), "tab\tkey"])("malformed %p -> 400 in both modes", (key) => {
    expect(() => pre.readIdempotencyKey(req(key))).toThrow(expect.objectContaining({ status: 400, code: "IDEMPOTENCY_KEY_INVALID" }));
    process.env[MODE] = "enforce";
    expect(() => pre.readIdempotencyKey(req(key))).toThrow(expect.objectContaining({ status: 400, code: "IDEMPOTENCY_KEY_INVALID" }));
  });
});

describe("Idempotency-Key from the body (idempotencyKey)", () => {
  const both = (header, body) => ({
    headers: header === undefined ? {} : { "idempotency-key": header },
    body: body === undefined ? {} : { idempotencyKey: body },
  });
  test("body only, header only, both equal", () => {
    expect(pre.readIdempotencyKey(both(undefined, "k-body"))).toBe("k-body");
    expect(pre.readIdempotencyKey(both("k-head", undefined))).toBe("k-head");
    expect(pre.readIdempotencyKey(both("k-same", " k-same "))).toBe("k-same");
  });
  test("both present and different -> 400", () => {
    expect(() => pre.readIdempotencyKey(both("k-1", "k-2"))).toThrow(
      expect.objectContaining({ status: 400, code: "IDEMPOTENCY_KEY_INVALID" }),
    );
  });
  test("non-string body value -> 400; malformed body value -> 400", () => {
    expect(() => pre.readIdempotencyKey(both(undefined, 42))).toThrow(expect.objectContaining({ status: 400, code: "IDEMPOTENCY_KEY_INVALID" }));
    expect(() => pre.readIdempotencyKey(both(undefined, "a b"))).toThrow(expect.objectContaining({ status: 400, code: "IDEMPOTENCY_KEY_INVALID" }));
  });
  test("enforce: a body key satisfies the requirement", () => {
    process.env[MODE] = "enforce";
    expect(pre.readIdempotencyKey(both(undefined, "k-body"))).toBe("k-body");
  });
});

describe("expectedReviewVersion", () => {
  test("compat: absent -> null; integer -> value", () => {
    expect(pre.readExpectedReviewVersion(undefined)).toBeNull();
    expect(pre.readExpectedReviewVersion(null)).toBeNull();
    expect(pre.readExpectedReviewVersion(0)).toBe(0);
    expect(pre.readExpectedReviewVersion(7)).toBe(7);
  });
  test("enforce: absent -> 428 when required, null when optional", () => {
    process.env[MODE] = "enforce";
    expect(() => pre.readExpectedReviewVersion(undefined)).toThrow(expect.objectContaining({ status: 428, code: "REVIEW_VERSION_REQUIRED" }));
    expect(pre.readExpectedReviewVersion(undefined, { required: false })).toBeNull();
  });
  test.each(["1", -1, 1.5, {}, true])("malformed %p -> 400 REVIEW_VERSION_INVALID", (v) => {
    expect(() => pre.readExpectedReviewVersion(v)).toThrow(expect.objectContaining({ status: 400, code: "REVIEW_VERSION_INVALID" }));
  });
  test("conflict check", () => {
    expect(() => pre.assertExpectedReviewVersion(null, 3)).not.toThrow();
    expect(() => pre.assertExpectedReviewVersion(3, 3)).not.toThrow();
    expect(() => pre.assertExpectedReviewVersion(2, 3)).toThrow(
      expect.objectContaining({ status: 409, code: "REVIEW_VERSION_CONFLICT", reviewVersion: 3 }),
    );
  });
});

describe("assertApprovalPaymentBinding", () => {
  const latest = (over = {}) => ({ applicationId: "app-1", paymentIntentId: "pi_1", ...over });
  test("no intent -> nothing to bind", () => {
    expect(() => assertApprovalPaymentBinding({ applicationId: "app-1", paymentIntentId: null, latestPayment: null })).not.toThrow();
  });
  test("LINK mode intent is bound by construction", () => {
    expect(() => assertApprovalPaymentBinding({ applicationId: "app-1", paymentIntentId: "pi_l", latestPayment: null, mode: "LINK" })).not.toThrow();
  });
  test("INLINE record for this application and intent -> ok", () => {
    expect(() => assertApprovalPaymentBinding({ applicationId: "app-1", paymentIntentId: "pi_1", latestPayment: latest() })).not.toThrow();
  });
  test("INLINE without an account record, or a record without applicationId -> 409 PAYMENT_BINDING_MISSING", () => {
    for (const lp of [null, latest({ applicationId: undefined }), latest({ applicationId: "" })]) {
      expect(() => assertApprovalPaymentBinding({ applicationId: "app-1", paymentIntentId: "pi_1", latestPayment: lp })).toThrow(
        expect.objectContaining({ status: 409, code: "PAYMENT_BINDING_MISSING" }),
      );
    }
  });
  test("INLINE record of another application, or another intent -> 409 PAYMENT_APPLICATION_MISMATCH", () => {
    for (const [intent, lp] of [
      ["pi_1", latest({ applicationId: "app-2" })],
      ["pi_local", latest()],
    ]) {
      expect(() => assertApprovalPaymentBinding({ applicationId: "app-1", paymentIntentId: intent, latestPayment: lp })).toThrow(
        expect.objectContaining({ status: 409, code: "PAYMENT_APPLICATION_MISMATCH" }),
      );
    }
  });
});

describe("payment binding policy by action (owner decision)", () => {
  const latest = (over = {}) => ({ applicationId: "app-1", paymentIntentId: "pi_1", ...over });
  test("capture: verified record -> mutate; no record -> 409 PAYMENT_BINDING_MISSING", () => {
    expect(assertApprovalPaymentBinding({ applicationId: "app-1", paymentIntentId: "pi_1", latestPayment: latest(), action: "capture" })).toEqual({ mutate: true });
    expect(() => assertApprovalPaymentBinding({ applicationId: "app-1", paymentIntentId: "pi_1", latestPayment: null, action: "capture" })).toThrow(
      expect.objectContaining({ code: "PAYMENT_BINDING_MISSING" }),
    );
  });
  test("cancel: no account record -> no mutation (unpaid application can be rejected)", () => {
    expect(assertApprovalPaymentBinding({ applicationId: "app-1", paymentIntentId: "pi_local", latestPayment: null, action: "cancel" })).toEqual({ mutate: false });
    expect(assertApprovalPaymentBinding({ applicationId: "app-1", paymentIntentId: null, latestPayment: null, action: "cancel" })).toEqual({ mutate: false });
  });
  test("cancel: malformed / foreign record -> fail closed", () => {
    expect(() => assertApprovalPaymentBinding({ applicationId: "app-1", paymentIntentId: "pi_1", latestPayment: latest({ applicationId: null }), action: "cancel" })).toThrow(
      expect.objectContaining({ code: "PAYMENT_BINDING_MISSING" }),
    );
    expect(() => assertApprovalPaymentBinding({ applicationId: "app-1", paymentIntentId: "pi_1", latestPayment: latest({ applicationId: "app-2" }), action: "cancel" })).toThrow(
      expect.objectContaining({ code: "PAYMENT_APPLICATION_MISMATCH" }),
    );
  });
});

describe("operationHash", () => {
  test("stable under key order, distinct across payloads and routes", () => {
    expect(pre.operationHash("approve", { a: 1, b: { c: 2, d: 3 } })).toBe(pre.operationHash("approve", { b: { d: 3, c: 2 }, a: 1 }));
    expect(pre.operationHash("approve", { a: 1 })).not.toBe(pre.operationHash("approve", { a: 2 }));
    expect(pre.operationHash("approve", { a: 1 })).not.toBe(pre.operationHash("reject", { a: 1 }));
    expect(pre.operationHash("approve", { a: 1, b: undefined })).toBe(pre.operationHash("approve", { a: 1 }));
  });
});

describe("observeDecision (enforce-switch evidence)", () => {
  beforeEach(() => jest.spyOn(console, "info").mockImplementation(() => {}));
  test("logs one observed line per request; the compatibility line only when something is missing", () => {
    pre.observeDecision("approve", { idempotencyKey: true, expectedReviewVersion: true });
    pre.observeDecision("reject", { idempotencyKey: false, expectedReviewVersion: true });
    pre.observeDecision("bulk-approval", { idempotencyKey: true, expectedReviewVersion: false, rows: 3, rowsWithVersion: 2 });
    const observed = console.info.mock.calls.filter((c) => c[0] === "[decision-preconditions] observed").map((c) => c[1]);
    expect(observed).toEqual([
      { route: "approve", mode: "compat", idempotencyKey: true, expectedReviewVersion: true, versionRequired: true },
      { route: "reject", mode: "compat", idempotencyKey: false, expectedReviewVersion: true, versionRequired: true },
      { route: "bulk-approval", mode: "compat", idempotencyKey: true, expectedReviewVersion: false, versionRequired: true, rows: 3, rowsWithVersion: 2 },
    ]);
    const compat = console.warn.mock.calls.filter((c) => String(c[0]).includes("compatibility window"));
    expect(compat.map((c) => c[1].route)).toEqual(["reject", "bulk-approval"]);
  });
});


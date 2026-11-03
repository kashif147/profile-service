"use strict";
/**
 * P5 S2 (caller side, profile): the application approve/reject decision claim under REAL concurrency.
 * Runs against a real (disposable) MongoDB so findOneAndUpdate atomicity is the database's, not an
 * in-memory model's. Skipped unless P5_DECISION_MONGO_URI is set (never a shared database).
 *
 * - concurrent approve vs reject: exactly one decision is claimed, the other gets 409
 *   PAYMENT_DECISION_CONFLICT, and the stored decision is the winner's;
 * - concurrent double approve (double click / two tabs): every caller gets the SAME claim id, so the
 *   payment command they send is the same deterministic command (account replays it idempotently);
 * - a crash after claiming (no release) is recoverable: re-running the same action reuses the claim.
 */
const mongoose = require("mongoose");
const crypto = require("crypto");

// The model graph pulls in uuid (ESM dist that this jest config does not transform); stub it.
jest.mock("uuid", () => ({ v4: () => require("crypto").randomUUID() }));

const URI = process.env.P5_DECISION_MONGO_URI;
const d = URI ? describe : describe.skip;

d("payment decision claim - real database concurrency", () => {
  let PersonalDetails;
  let decision;
  const T = "aaaaaaaaaaaaaaaaaaaaaaaa";

  beforeAll(async () => {
    await mongoose.connect(URI);
    PersonalDetails = require("../models/personal.details.model.js");
    decision = require("../services/applicationPaymentDecision.service.js");
  });

  afterAll(async () => {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });

  async function seedApplication(extra = {}) {
    const applicationId = crypto.randomUUID();
    await PersonalDetails.collection.insertOne({ tenantId: T, applicationId, applicationStatus: "submitted", ...extra });
    return applicationId;
  }

  test("concurrent approve vs reject: exactly one decision wins", async () => {
    for (let round = 0; round < 20; round++) {
      const applicationId = await seedApplication();
      const results = await Promise.allSettled([
        decision.claimPaymentDecision({ applicationId, tenantId: T, action: "approve", actorUserId: "u1" }),
        decision.claimPaymentDecision({ applicationId, tenantId: T, action: "reject", actorUserId: "u2" }),
      ]);
      const won = results.filter((r) => r.status === "fulfilled");
      const lost = results.filter((r) => r.status === "rejected");
      expect(won).toHaveLength(1);
      expect(won[0].value.reused).toBe(false);
      expect(lost).toHaveLength(1);
      expect(lost[0].reason).toMatchObject({ status: 409, code: "PAYMENT_DECISION_CONFLICT" });
      const stored = await PersonalDetails.collection.findOne({ applicationId });
      const winner = results[0].status === "fulfilled" ? "approve" : "reject";
      expect(stored.paymentDecision.action).toBe(winner);
      expect(stored.paymentDecision.claimId).toBe(won[0].value.claimId);
    }
  });

  test("concurrent double approve: one claim, every caller gets the same claim id", async () => {
    for (let round = 0; round < 20; round++) {
      const applicationId = await seedApplication();
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          decision.claimPaymentDecision({ applicationId, tenantId: T, action: "approve", actorUserId: "u1" }),
        ),
      );
      expect(results.filter((r) => !r.reused)).toHaveLength(1);
      expect(new Set(results.map((r) => r.claimId)).size).toBe(1);
    }
  });

  test("crash after claiming (no release): the same action recovers by reusing the claim; the opposite stays blocked", async () => {
    const applicationId = await seedApplication();
    const first = await decision.claimPaymentDecision({ applicationId, tenantId: T, action: "approve", actorUserId: "u1" });
    // ...process dies here: no capture result, no release.
    const retry = await decision.claimPaymentDecision({ applicationId, tenantId: T, action: "approve", actorUserId: "u1" });
    expect(retry).toEqual({ claimId: first.claimId, reused: true });
    await expect(
      decision.claimPaymentDecision({ applicationId, tenantId: T, action: "reject", actorUserId: "u2" }),
    ).rejects.toMatchObject({ status: 409, code: "PAYMENT_DECISION_CONFLICT" });
  });

  test("a final application is never claimed, and another tenant's application is not found", async () => {
    const done = await seedApplication({ applicationStatus: "processed" });
    await expect(
      decision.claimPaymentDecision({ applicationId: done, tenantId: T, action: "approve" }),
    ).rejects.toMatchObject({ status: 409, code: "APPLICATION_ALREADY_DECIDED" });
    const mine = await seedApplication();
    await expect(
      decision.claimPaymentDecision({ applicationId: mine, tenantId: "bbbbbbbbbbbbbbbbbbbbbbbb", action: "approve" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

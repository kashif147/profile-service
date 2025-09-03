// consumers/applicationApproved.consumer.js (subscription-service)
import Subscription from "../src/models/subscription.model.js";
import { consumeTopic } from "../../infra/rabbit/consumer.js";
import { ensureEventIdempotent } from "../../infra/idempotency.js";

export default function registerSubscriptionConsumer() {
  consumeTopic(
    "domain.events",
    "applications.review.approved.v1",
    async (msg, ack, nack) => {
      try {
        const { eventId, tenantId, applicationId, profileId, effective } = msg;
        const s = effective?.subscriptionDetails || {};

        await ensureEventIdempotent(eventId, async () => {
          await Subscription.updateOne(
            { tenantId, applicationId }, // unique pair prevents duplicates
            {
              $set: {
                tenantId,
                profileId, // link to profile
                membershipCategory: s.membershipCategory ?? null,
                membershipStatus: s.membershipStatus ?? "ACTIVE",
                dateJoined: s.dateJoined ? new Date(s.dateJoined) : new Date(),
                dateLeft: s.dateLeft ? new Date(s.dateLeft) : null,
                reasonLeft: s.reasonLeft ?? null,
                paymentType: s.paymentType ?? "PAYROLL_DEDUCTION",
                paymentFrequency: s.paymentFrequency ?? "MONTHLY",
              },
              $setOnInsert: { applicationId },
            },
            { upsert: true }
          );
        });

        ack();
      } catch (err) {
        console.error("subscription consumer error:", err);
        nack(err);
      }
    }
  );
}

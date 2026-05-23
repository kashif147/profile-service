const { publisher } = require("@projectShell/rabbitmq-middleware");
const { PAYMENT_FORM_EVENTS } = require("../events/paymentForm.events.js");

class PaymentFormEventPublisher {
  async publishPaymentFormApproved({
    tenantId,
    userId,
    profileId,
    paymentFormId,
    formType,
    membershipNumber,
    correlationId,
  }) {
    return publisher.publish(
      PAYMENT_FORM_EVENTS.PAYMENT_FORM_APPROVED,
      {
        tenantId,
        userId,
        profileId,
        paymentFormId,
        formType,
        memberId: membershipNumber,
        membershipNumber,
      },
      {
        tenantId,
        correlationId,
        exchange: "membership.events",
        routingKey: PAYMENT_FORM_EVENTS.PAYMENT_FORM_APPROVED,
        metadata: { service: "profile-service", version: "1.0" },
      }
    );
  }

  async publishMemberNotificationRequested({
    tenantId,
    userId,
    profileId,
    title,
    body,
    metadata,
    correlationId,
  }) {
    return publisher.publish(
      PAYMENT_FORM_EVENTS.MEMBER_NOTIFICATION_REQUESTED,
      {
        tenantId,
        userId,
        profileId,
        title,
        body,
        metadata,
      },
      {
        tenantId,
        correlationId,
        exchange: "membership.events",
        routingKey: PAYMENT_FORM_EVENTS.MEMBER_NOTIFICATION_REQUESTED,
        metadata: { service: "profile-service", version: "1.0" },
      }
    );
  }
}

module.exports = new PaymentFormEventPublisher();

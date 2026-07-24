# RabbitMQ

Inbound consumers (`rabbitMQ/index.js`): `user.events` (CRM/portal user created/updated),
`application.events` (`applications.review.processed.v1`), `membership.events` (member-created,
subscription current/resigned/cancelled/undone), and `portal.events` (`profile.application.create` —
the event portal-service publishes once payment is captured, which is what actually creates the
staging `PersonalDetails`/etc. records here).

**`rabbitMQ/listeners/profile.application.create.listener.js` and
`profile.application.create.listerner.js` (misspelled) are both real and both required** — the
misspelled file holds the actual ~485-line implementation; the correctly-spelled one is a thin
wrapper `require`d by `listeners/eventHandler.js`. Don't "fix the typo" by renaming/deleting one
without updating the other's `require` path — doing so breaks event processing silently, with no
startup error.

Outbound publishers cover: application approval/rejection + gap-letter/member-created/
subscription-upsert requests (`publishers/application.approval.publisher.js`), payment-form approval
(`publishers/paymentForm.publisher.js`), executive council decisions
(`executiveCouncilApproval.service.js`), duplicate-review audit trail
(`duplicate.review.audit.publisher.js`, `profile.duplicate.audit.publisher.js`), and generic profile
create/update audit events (`profile.audit.publisher.js`, via the shared
`@projectShell/rabbitmq-middleware` publisher rather than a hardcoded exchange).

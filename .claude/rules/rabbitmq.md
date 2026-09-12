# RabbitMQ

Inbound consumers (`rabbitMQ/index.js`): `user.events` (CRM/portal user created/updated),
`application.events` (`applications.review.processed.v1`), `membership.events` (member-created,
subscription current/resigned/cancelled/undone), `portal.events` (`profile.application.create` —
the event portal-service publishes once payment is captured, which is what actually creates the
staging `PersonalDetails`/etc. records here), and `events.events` (owned by events-service, not one
of the shared middleware's default exchanges — declared explicitly in `initEventSystem`'s own
`exchanges` list, the same way communication-service does for the same exchange) —
`events.certificate.issued.v1` → `rabbitMQ/listeners/certificateIssued.listener.js`'s
`handleCertificateIssued()`, which upserts a `models/qualification.model.js` (`Qualification`) row
(unique on `{tenantId, profileId, registrationId}`, so redelivery is a safe no-op). This is the
platform's first "member training/course-completion record" concept — before this, the only
remotely related field was a flat, unrelated `personalInfo.countryPrimaryQualification` string
(which country a member's *primary* nursing qualification came from).

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

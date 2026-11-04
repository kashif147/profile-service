const mongoose = require("mongoose");

// P5 signed service authority (verifier side): replay store for x-svc-nonce
// (middlewares/serviceSignatureAuth.js). One row per (caller, nonce), inserted atomically AFTER the
// signature verifies; the unique index turns a second use of the same nonce into a duplicate-key
// error (= replay). Rows expire via the TTL index well after the +/-60 s timestamp window, so an
// expired nonce can never be reused inside the window. Holds no secret, signature or payload -
// only the caller id, nonce and time. Lives in profile-service's OWN database.
const ServiceAuthNonceSchema = new mongoose.Schema(
  {
    caller: { type: String, required: true },
    nonce: { type: String, required: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: "serviceAuthNonces", strict: "throw", versionKey: false },
);
ServiceAuthNonceSchema.index({ caller: 1, nonce: 1 }, { unique: true });
ServiceAuthNonceSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 });

module.exports =
  mongoose.models.ServiceAuthNonce || mongoose.model("ServiceAuthNonce", ServiceAuthNonceSchema);

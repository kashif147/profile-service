/**
 * Minimal pino-call-shape shim for services/paymentFormPdf/membershipFormPdf.js, which was
 * copied from notification-service (where this path is a real pino instance). Only `.warn(obj,
 * msg)` is used here (the sd19 layout-detect fallback warning), so a full pino/pino-pretty
 * dependency isn't worth adding to this service just for that — this service otherwise logs via
 * plain `console` (see middlewares/logger.mw.js).
 */
module.exports = {
  warn(obj, msg) {
    console.warn(msg, obj);
  },
};

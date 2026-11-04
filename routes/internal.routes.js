/**
 * Signed service-to-service reads (P5). Mounted at /api/internal in app.js BEFORE the global
 * `authenticate`: these routes take no user token. Their only authority is the p5-svc-sig/1
 * signature verified by middlewares/serviceSignatureAuth.js, which also refuses (404) any request
 * carrying gateway identity, so they are not reachable through the gateway's JWT locations.
 *
 *   GET /api/internal/applications/:applicationId/refund-state
 *       caller: account-service only; operation application_refund_state.
 *       200 {"data":{"applicationId","tenantId","status"}} - status of the application in the
 *       SIGNED tenant only. See controllers/internalApplicationRefundState.controller.js.
 */
const express = require("express");
const { createServiceSignatureAuth } = require("../middlewares/serviceSignatureAuth");
const { getApplicationRefundState } = require("../controllers/internalApplicationRefundState.controller");

function createInternalRouter(deps = {}) {
  const router = express.Router({ caseSensitive: true, strict: true });
  router.get(
    "/applications/:applicationId/refund-state",
    createServiceSignatureAuth("application_refund_state", deps),
    (req, res) => getApplicationRefundState(req, res, deps),
  );
  // Nothing else is served under /api/internal: same 404 shape as app.js.
  router.use((req, res) => res.status(404).json({ error: "NOT_FOUND", message: "Not found", path: req.originalUrl }));
  return router;
}

module.exports = createInternalRouter();
module.exports.createInternalRouter = createInternalRouter;

/**
 * GET /api/internal/applications/:applicationId/refund-state (P5 application refund state).
 *
 * Runs only after middlewares/serviceSignatureAuth.js accepted the signed request; the tenant is
 * req.serviceAuth.tenantId (the SIGNED x-tenant-id), never a query/body value. Lookup is by
 * (tenantId, applicationId) on the application root (PersonalDetails, same applicationId /
 * legacy ApplicationId shape as memberAccess.isOwnApplication), so an application of another
 * tenant is indistinguishable from a missing one (404).
 *
 * Responses (nothing else is ever returned):
 *   200 {"data":{"applicationId","tenantId","status"}}  status in-progress|submitted|processed|rejected
 *   404 APPLICATION_NOT_FOUND           unknown / malformed id, or not in the signed tenant
 *   422 APPLICATION_STATE_UNRECOGNISED  stored status outside the four values (data inconsistency)
 *   503 APPLICATION_STATE_UNAVAILABLE   profile database unavailable
 */
const mongoose = require("mongoose");
const { APPLICATION_STATUS } = require("../constants/enums");

const APPLICATION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const STATUSES = new Set(Object.values(APPLICATION_STATUS));

function fail(res, status, code, message) {
  return res.status(status).json({ success: false, code, message });
}

async function getApplicationRefundState(req, res, deps = {}) {
  const tenantId = req.serviceAuth && req.serviceAuth.tenantId;
  const applicationId = String((req.params && req.params.applicationId) || "");
  if (!tenantId) return fail(res, 503, "APPLICATION_STATE_UNAVAILABLE", "Application state is unavailable");
  if (!APPLICATION_ID_RE.test(applicationId)) return fail(res, 404, "APPLICATION_NOT_FOUND", "Application not found");
  const PersonalDetails = deps.PersonalDetails || require("../models/personal.details.model.js");
  const dbReady = deps.dbReady ? deps.dbReady() : mongoose.connection.readyState === 1;
  if (!dbReady) return fail(res, 503, "APPLICATION_STATE_UNAVAILABLE", "Application state is unavailable");
  let root;
  try {
    root = await PersonalDetails.findOne({
      tenantId: String(tenantId),
      $or: [{ applicationId }, { ApplicationId: applicationId }],
    })
      .select({ applicationStatus: 1, tenantId: 1 })
      .lean();
  } catch (_e) {
    return fail(res, 503, "APPLICATION_STATE_UNAVAILABLE", "Application state is unavailable");
  }
  if (!root || String(root.tenantId) !== String(tenantId)) {
    return fail(res, 404, "APPLICATION_NOT_FOUND", "Application not found");
  }
  const status = String(root.applicationStatus || "");
  if (!STATUSES.has(status)) {
    return fail(res, 422, "APPLICATION_STATE_UNRECOGNISED", "Application state is not recognised");
  }
  return res.status(200).json({ data: { applicationId, tenantId: String(tenantId), status } });
}

module.exports = { getApplicationRefundState, APPLICATION_ID_RE };

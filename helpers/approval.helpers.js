const {
  approveApplication: approveSvc,
  rejectApplication: rejectSvc,
} = require("../services/approval.service.js");

// wraps the service call to keep controllers thin
async function approveWithOverlay({
  applicationId,
  overlayId,
  overlayVersion,
  reviewerId,
  tenantId,
}) {
  return await approveSvc({
    applicationId,
    overlayId,
    overlayVersion,
    reviewerId,
    tenantId,
  });
}

async function rejectWithReason({
  applicationId,
  reason,
  notes,
  reviewerId,
  tenantId,
}) {
  return await rejectSvc({
    applicationId,
    reason,
    notes,
    reviewerId,
    tenantId,
  });
}

module.exports = { approveWithOverlay, rejectWithReason };

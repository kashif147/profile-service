import {
  approveApplication as approveSvc,
  rejectApplication as rejectSvc,
} from "../services/approval.service.js";

// wraps the service call to keep controllers thin
export async function approveWithOverlay({
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

export async function rejectWithReason({
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

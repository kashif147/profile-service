const crypto = require("crypto");
const Profile = require("../models/profile.model.js");
const ApplicationApprovalEventPublisher = require("../rabbitMQ/publishers/application.approval.publisher.js");
const { publishProfileAudit } = require("./profile.audit.publisher.js");
const {
  resolvePortalUserServiceId,
} = require("../helpers/portalUserIdentity.js");

/**
 * Publish approval side-effects after the Mongo transaction commits so
 * downstream services (subscription → reporting snapshot) can read the profile.
 */
async function publishPostApprovalEvents({
  applicationId,
  reviewerId,
  profileId,
  tenantId,
  isExistingProfile,
  updatedProfile,
  linkedUserId,
  effective,
  memberId,
  dateJoined,
  processingDate,
  deactivatePreviousSubscriptionStatus,
  correlationId = crypto.randomUUID(),
}) {
  const resolvedDeactivatePreviousSubscriptionStatus =
    deactivatePreviousSubscriptionStatus ??
    (isExistingProfile ? "Cancelled" : undefined);

  const sub = effective.subscriptionDetails || {};
  const userEmailForPostApproval =
    effective.contactInfo?.personalEmail ||
    effective.contactInfo?.workEmail ||
    null;
  const userIdForPostApproval = await resolvePortalUserServiceId({
    tenantId,
    profileUserId: updatedProfile?.userId,
    linkedUserId,
    userEmail: userEmailForPostApproval,
  });

  try {
    await ApplicationApprovalEventPublisher.publishApplicationApproved({
      applicationId,
      reviewerId,
      profileId: String(profileId),
      applicationStatus: "processed",
      isExistingProfile: !!isExistingProfile,
      crmUserId: updatedProfile?.crmUserId
        ? String(updatedProfile.crmUserId)
        : null,
      memberId,
      userId: userIdForPostApproval,
      userEmail: userEmailForPostApproval,
      effective: {
        personalInfo: effective.personalInfo,
        contactInfo: effective.contactInfo,
        professionalDetails: effective.professionalDetails,
        subscriptionDetails: effective.subscriptionDetails,
      },
      subscriptionAttributes: effective.subscriptionAttributes,
      tenantId,
      correlationId,
    });
  } catch (err) {
    console.error(
      "[publishPostApprovalEvents] application processed failed:",
      err.message,
    );
  }

  try {
    await ApplicationApprovalEventPublisher.publishMemberCreatedRequested({
      applicationId,
      profileId: String(profileId),
      isExistingProfile: !!isExistingProfile,
      crmUserId: updatedProfile?.crmUserId
        ? String(updatedProfile.crmUserId)
        : null,
      memberId,
      effective,
      subscriptionAttributes: effective.subscriptionAttributes,
      tenantId,
      correlationId: crypto.randomUUID(),
    });
  } catch (err) {
    console.error(
      "[publishPostApprovalEvents] member created requested failed:",
      err.message,
    );
  }

  try {
    await ApplicationApprovalEventPublisher.publishSubscriptionUpsertRequested({
      tenantId,
      profileId: String(profileId),
      applicationId,
      memberId,
      membershipCategory:
        sub.membershipCategory ??
        effective.professionalDetails?.membershipCategory ??
        null,
      dateJoined,
      processingDate: processingDate ?? null,
      submissionDate: sub.submissionDate ?? null,
      applicationDate: sub.applicationDate ?? effective.applicationDate ?? null,
      paymentType: sub.paymentType ?? null,
      payrollNo: sub.payrollNo ?? null,
      paymentFrequency: sub.paymentFrequency ?? null,
      userId: userIdForPostApproval,
      userEmail: userEmailForPostApproval,
      reviewerId,
      deactivatePreviousSubscriptionStatus:
        resolvedDeactivatePreviousSubscriptionStatus,
      correlationId: crypto.randomUUID(),
    });
  } catch (err) {
    console.error(
      "[publishPostApprovalEvents] subscription upsert failed:",
      err.message,
    );
  }

  try {
    const freshProfile = await Profile.findById(profileId).lean();
    if (freshProfile) {
      await publishProfileAudit("profile.updated", {
        tenantId,
        profileId,
        after: freshProfile,
        actorId: reviewerId,
        source: "publishPostApprovalEvents",
      });
    }
  } catch (err) {
    console.error(
      "[publishPostApprovalEvents] profile.updated for reporting failed:",
      err.message,
    );
  }
}

module.exports = { publishPostApprovalEvents };

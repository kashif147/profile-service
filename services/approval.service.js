// services/approval.service.js
const mongoose = require("mongoose");
const jsonPatch = require("fast-json-patch");
const { applyPatch } = jsonPatch;
const crypto = require("crypto");
const {
  publishDomainEvent,
  APPLICATION_REVIEW_EVENTS,
} = require("../rabbitMQ/index.js");

// Helper function to handle bypass user ObjectId conversion
function getReviewerIdForDb(reviewerId) {
  if (reviewerId === "bypass-user") {
    return null; // Allow null for bypass users
  }
  return reviewerId;
}
const ReviewOverlay = require("../models/reviewOverlay.model.js");
const PersonalDetails = require("../models/personal.details.model.js");
const ProfessionalDetails = require("../models/professional.details.model.js");
const SubscriptionDetails = require("../models/subscription.model.js");
const Profile = require("../models/profile.model.js");
const { loadSubmission } = require("./submission.service.js");
const { ApplicationApprovalEventPublisher } = require("../rabbitMQ/index.js");
const { APPLICATION_STATUS } = require("../constants/constants.js");

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

async function approveApplication({
  applicationId,
  overlayId,
  overlayVersion,
  reviewerId,
  tenantId,
}) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // Load submission and overlay
    const { submission } = await loadSubmission(applicationId);
    const overlay = await ReviewOverlay.findOne({
      overlayId,
      applicationId,
      status: "open",
    }).session(session);
    if (!overlay) throw new Error("Open overlay not found");
    if (overlay.overlayVersion !== overlayVersion) {
      throw Object.assign(new Error("Overlay version conflict"), {
        statusCode: 409,
      });
    }

    // Compute effective
    const effective = applyPatch(
      deepClone(submission),
      overlay.proposedPatch
    ).newDocument;
    const effectiveHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(effective))
      .digest("hex");

    // 1) Find existing profile or create new one
    const email =
      effective.contactInfo?.personalEmail || effective.contactInfo?.workEmail;
    if (!email) throw new Error("No email found in effective data");

    const normalizedEmail = email.toLowerCase();
    let existingProfile = await Profile.findOne({
      tenantId,
      normalizedEmail,
    }).session(session);

    let profile;
    if (existingProfile) {
      // Update existing profile - keep existing membership number
      const profileUpdate = {
        personalInfo: effective.personalInfo,
        contactInfo: effective.contactInfo,
        professionalDetails: effective.professionalDetails,
        subscriptionAttributes: {
          payrollNo: effective.subscriptionDetails?.payrollNo,
          otherIrishTradeUnion:
            !!effective.subscriptionDetails?.otherIrishTradeUnion,
          otherScheme: !!effective.subscriptionDetails?.otherScheme,
          recuritedBy: effective.subscriptionDetails?.recuritedBy,
          recuritedByMembershipNo:
            effective.subscriptionDetails?.recuritedByMembershipNo,
          primarySection: effective.subscriptionDetails?.primarySection,
          otherPrimarySection:
            effective.subscriptionDetails?.otherPrimarySection,
          secondarySection: effective.subscriptionDetails?.secondarySection,
          otherSecondarySection:
            effective.subscriptionDetails?.otherSecondarySection,
          incomeProtectionScheme:
            !!effective.subscriptionDetails?.incomeProtectionScheme,
          inmoRewards: !!effective.subscriptionDetails?.inmoRewards,
          valueAddedServices:
            !!effective.subscriptionDetails?.valueAddedServices,
          termsAndConditions:
            effective.subscriptionDetails?.termsAndConditions !== false,
        },
        applicationStatus: APPLICATION_STATUS.APPROVED,
        approvalDetails: {
          approvedBy: getReviewerIdForDb(reviewerId),
          approvedAt: new Date(),
          comments: overlay.notes ?? undefined,
          effectiveHash,
          effectiveSnapshot: effective,
        },
      };

      await Profile.updateOne(
        { _id: existingProfile._id },
        { $set: profileUpdate },
        { session }
      );
      profile = existingProfile;
    } else {
      // Create new profile - will get new membership number
      const profileUpdate = {
        tenantId,
        email,
        normalizedEmail,
        mobileNumber: effective.contactInfo?.mobileNumber,
        surname: effective.personalInfo?.surname,
        forename: effective.personalInfo?.forename,
        dateOfBirth: effective.personalInfo?.dateOfBirth,
        personalInfo: effective.personalInfo,
        contactInfo: effective.contactInfo,
        professionalDetails: effective.professionalDetails,
        subscriptionAttributes: {
          payrollNo: effective.subscriptionDetails?.payrollNo,
          otherIrishTradeUnion:
            !!effective.subscriptionDetails?.otherIrishTradeUnion,
          otherScheme: !!effective.subscriptionDetails?.otherScheme,
          recuritedBy: effective.subscriptionDetails?.recuritedBy,
          recuritedByMembershipNo:
            effective.subscriptionDetails?.recuritedByMembershipNo,
          primarySection: effective.subscriptionDetails?.primarySection,
          otherPrimarySection:
            effective.subscriptionDetails?.otherPrimarySection,
          secondarySection: effective.subscriptionDetails?.secondarySection,
          otherSecondarySection:
            effective.subscriptionDetails?.otherSecondarySection,
          incomeProtectionScheme:
            !!effective.subscriptionDetails?.incomeProtectionScheme,
          inmoRewards: !!effective.subscriptionDetails?.inmoRewards,
          valueAddedServices:
            !!effective.subscriptionDetails?.valueAddedServices,
          termsAndConditions:
            effective.subscriptionDetails?.termsAndConditions !== false,
        },
        applicationStatus: APPLICATION_STATUS.APPROVED,
        approvalDetails: {
          approvedBy: getReviewerIdForDb(reviewerId),
          approvedAt: new Date(),
          comments: overlay.notes ?? undefined,
          effectiveHash,
          effectiveSnapshot: effective,
        },
      };

      await Profile.updateOne(
        { tenantId, normalizedEmail },
        { $set: profileUpdate },
        { upsert: true, session }
      );

      // Get the created profile
      profile = await Profile.findOne({ tenantId, normalizedEmail }).session(
        session
      );
    }

    // 2) Update PersonalDetails with effective personal/contact AND approval metadata
    const personalUpdate = {
      personalInfo: effective.personalInfo ?? null,
      contactInfo: effective.contactInfo ?? null,
      applicationStatus: APPLICATION_STATUS.APPROVED,
      approvalDetails: {
        approvedBy: getReviewerIdForDb(reviewerId),
        approvedAt: new Date(),
        comments: overlay.notes ?? undefined,
      },
    };
    await PersonalDetails.updateOne(
      { ApplicationId: applicationId },
      { $set: personalUpdate }
    ).session(session);

    // 2) Update ProfessionalDetails and SubscriptionDetails from effective
    if (effective.professionalDetails) {
      await ProfessionalDetails.updateOne(
        { ApplicationId: applicationId },
        { $set: { professionalDetails: effective.professionalDetails } },
        { upsert: true, session }
      );
    }

    if (effective.subscriptionDetails) {
      await SubscriptionDetails.updateOne(
        { ApplicationId: applicationId },
        { $set: { subscriptionDetails: effective.subscriptionDetails } },
        { upsert: true, session }
      );
    }

    // 3) Close overlay (decided)
    overlay.status = "decided";
    overlay.decision = "approved";
    overlay.decisionReason = undefined;
    overlay.overlayVersion += 1;
    await overlay.save({ session });

    // 4) Publish events using shared middleware
    // 4) Publish events using dedicated publisher
    await ApplicationApprovalEventPublisher.publishApplicationApproved({
      applicationId,
      reviewerId,
      profileId: String(profile._id),
      applicationStatus: APPLICATION_STATUS.APPROVED,
      isExistingProfile: !!existingProfile,
      effective,
      subscriptionAttributes: profile.subscriptionAttributes,
      tenantId,
      correlationId: crypto.randomUUID(),
    });

    await ApplicationApprovalEventPublisher.publishMemberCreatedRequested({
      applicationId,
      profileId: String(profile._id),
      isExistingProfile: !!existingProfile,
      effective,
      subscriptionAttributes: profile.subscriptionAttributes,
      tenantId,
      correlationId: crypto.randomUUID(),
    });

    await session.commitTransaction();
    return { applicationId, effectiveHash, status: "approved" };
  } catch (e) {
    await session.abortTransaction();
    throw e;
  } finally {
    session.endSession();
  }
}

async function rejectApplication({
  applicationId,
  reason,
  notes,
  reviewerId,
  tenantId,
}) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const overlay = await ReviewOverlay.findOne({
      applicationId,
      status: "open",
    }).session(session);
    if (!overlay) throw new Error("Open overlay not found");

    // Update PersonalDetails status and approvalDetails
    await PersonalDetails.updateOne(
      { ApplicationId: applicationId },
      {
        $set: {
          applicationStatus: "REJECTED",
          approvalDetails: {
            approvedBy: getReviewerIdForDb(reviewerId),
            approvedAt: new Date(),
            rejectionReason: reason,
            comments: notes,
          },
        },
      }
    ).session(session);

    overlay.status = "decided";
    overlay.decision = "rejected";
    overlay.decisionReason = reason;
    overlay.overlayVersion += 1;
    await overlay.save({ session });

    await publishDomainEvent(
      APPLICATION_REVIEW_EVENTS.APPLICATION_REVIEW_REJECTED,
      {
        applicationId,
        reviewerId,
        reason,
      },
      { tenantId, correlationId: crypto.randomUUID() }
    );

    await session.commitTransaction();
    return { applicationId, status: "rejected" };
  } catch (e) {
    await session.abortTransaction();
    throw e;
  } finally {
    session.endSession();
  }
}

module.exports = { approveApplication, rejectApplication };

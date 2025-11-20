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
const { APPLICATION_STATUS } = require("../constants/enums.js");
const { flattenProfilePayload } = require("../helpers/profile.transform.js");
const { generateMembershipNumber } = require("../helpers/membership.number.generator.js");

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function normalizeSubscriptionDetails(subscriptionDetails = {}, professional = {}) {
  const normalized = { ...subscriptionDetails };
  if (
    normalized.membershipCategory == null &&
    professional?.membershipCategory != null
  ) {
    normalized.membershipCategory = professional.membershipCategory;
  }
  return normalized;
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
    let effective = applyPatch(
      deepClone(submission),
      overlay.proposedPatch
    ).newDocument;
    const normalizedSubscriptionDetails = normalizeSubscriptionDetails(
      effective.subscriptionDetails,
      effective.professionalDetails
    );
    effective = {
      ...effective,
      subscriptionDetails: normalizedSubscriptionDetails,
    };

    const flattenedProfileFields = flattenProfilePayload(effective);

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
        ...flattenedProfileFields,
      };

      await Profile.updateOne(
        { _id: existingProfile._id },
        { $set: profileUpdate },
        { session }
      );
      profile = existingProfile;
    } else {
      // Create new profile (first-ever membership): set initial fields via upsert
      const now = new Date();
      
      // Generate membership number for new profile
      const membershipNumber = await generateMembershipNumber();
      
      await Profile.updateOne(
        { tenantId, normalizedEmail },
        {
          $set: {
            ...flattenedProfileFields,
          },
          $setOnInsert: {
            tenantId,
            normalizedEmail,
            membershipNumber: membershipNumber, // Auto-generated membership number for new profile
            firstJoinedDate: now,
            submissionDate: now,
            currentSubscriptionId: null,
            hasHistory: false,
          },
        },
        { upsert: true, session }
      );
      profile = await Profile.findOne({ tenantId, normalizedEmail }).session(session);
      console.log(`✅ Generated membership number ${membershipNumber} for new profile ${profile._id}`);
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
      { applicationId: applicationId },
      { $set: personalUpdate }
    ).session(session);

    // 2) Update ProfessionalDetails and SubscriptionDetails from effective
    if (effective.professionalDetails) {
      await ProfessionalDetails.updateOne(
        { applicationId: applicationId },
        { $set: { professionalDetails: effective.professionalDetails } },
        { upsert: true, session }
      );
    }

    if (effective.subscriptionDetails) {
      await SubscriptionDetails.findOneAndUpdate(
        { applicationId: applicationId },
        { $set: { subscriptionDetails: effective.subscriptionDetails } },
        { upsert: true, new: true, runValidators: true, session }
      );
      // Do not update Profile.currentSubscriptionId or hasHistory here.
      // This will be handled via subscription-service RabbitMQ events.
    }

    // 3) Close overlay (decided)
    overlay.status = "decided";
    overlay.decision = "approved";
    overlay.decisionReason = undefined;
    overlay.overlayVersion += 1;
    await overlay.save({ session });

    // 4) Publish events using shared middleware
    // 4) Publish events using dedicated publisher
    const subscriptionAttributes = {
      payrollNo: effective.subscriptionDetails?.payrollNo ?? null,
      otherIrishTradeUnion: !!effective.subscriptionDetails?.otherIrishTradeUnion,
      otherIrishTradeUnionName:
        effective.subscriptionDetails?.otherIrishTradeUnionName ?? null,
      otherScheme: !!effective.subscriptionDetails?.otherScheme,
      recuritedBy: effective.subscriptionDetails?.recuritedBy ?? null,
      recuritedByMembershipNo:
        effective.subscriptionDetails?.recuritedByMembershipNo ?? null,
      primarySection: effective.subscriptionDetails?.primarySection ?? null,
      otherPrimarySection:
        effective.subscriptionDetails?.otherPrimarySection ?? null,
      secondarySection: effective.subscriptionDetails?.secondarySection ?? null,
      otherSecondarySection:
        effective.subscriptionDetails?.otherSecondarySection ?? null,
      incomeProtectionScheme:
        !!effective.subscriptionDetails?.incomeProtectionScheme,
      inmoRewards: !!effective.subscriptionDetails?.inmoRewards,
      exclusiveDiscountsAndOffers:
        !!effective.subscriptionDetails?.exclusiveDiscountsAndOffers,
      valueAddedServices: !!effective.subscriptionDetails?.valueAddedServices,
      termsAndConditions:
        effective.subscriptionDetails?.termsAndConditions !== false,
      membershipCategory: effective.subscriptionDetails?.membershipCategory ?? null,
      membershipStatus: effective.subscriptionDetails?.membershipStatus ?? null,
      dateJoined: effective.subscriptionDetails?.dateJoined ?? null,
      submissionDate: effective.subscriptionDetails?.submissionDate ?? null,
      dateLeft: effective.subscriptionDetails?.dateLeft ?? null,
      reasonLeft: effective.subscriptionDetails?.reasonLeft ?? null,
    };

    await ApplicationApprovalEventPublisher.publishApplicationApproved({
      applicationId,
      reviewerId,
      profileId: String(profile._id),
      applicationStatus: APPLICATION_STATUS.APPROVED,
      isExistingProfile: !!existingProfile,
      effective,
      subscriptionAttributes,
      tenantId,
      correlationId: crypto.randomUUID(),
    });

    await ApplicationApprovalEventPublisher.publishMemberCreatedRequested({
      applicationId,
      profileId: String(profile._id),
      isExistingProfile: !!existingProfile,
      effective,
      subscriptionAttributes,
      tenantId,
      correlationId: crypto.randomUUID(),
    });

    // Publish subscription upsert request for subscription-service
    const sub = effective.subscriptionDetails || {};
    await ApplicationApprovalEventPublisher.publishSubscriptionUpsertRequested({
      tenantId,
      profileId: String(profile._id),
      applicationId,
      membershipCategory:
        sub.membershipCategory ??
        effective.professionalDetails?.membershipCategory ??
        null,
      dateJoined: sub.dateJoined ?? null,
      paymentType: sub.paymentType ?? null,
      payrollNo: sub.payrollNo ?? null,
      paymentFrequency: sub.paymentFrequency ?? null,
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
      { applicationId: applicationId },
      {
        $set: {
          applicationStatus: APPLICATION_STATUS.REJECTED,
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

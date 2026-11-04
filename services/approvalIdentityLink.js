"use strict";
/**
 * P5: approval never moves an existing profile's identity bindings.
 *
 * Incident shape: a LINK approval re-bound an existing member profile's Profile.userId (its portal
 * owner) to the applicant's portal user, so the original owner lost access to their own record
 * and the applicant gained it. Profile.userId is what portal object authorization uses
 * (middlewares/memberAccess.js resolveOwnProfile), so it is an access grant, not a data field.
 *
 * Rules (owner policy: pending until a separately authorised identity-link operation establishes
 * ownership; NO automatic binding of an existing profile on an email / member-number match):
 *   - an approval never changes an existing Profile.userId, normalizedEmail or (once set)
 *     crmUserId, and LINK/MERGE never change the profile's login-relevant contact emails
 *     (personalEmail, workEmail, preferredEmail);
 *   - LINK/MERGE never binds the applicant's portal user to an existing profile, bound or
 *     unbound. The applicant identity stays on the application (its own userId is not
 *     rewritten either) and is recorded as a PENDING identity-link decision
 *     (PersonalDetails.identityLink) for an explicit, separate CRM decision.
 */

let IdentityLinkRequest = null;
function requestModel() {
  return IdentityLinkRequest || (IdentityLinkRequest = require("../models/identityLinkRequest.model.js"));
}

const IDENTITY_CONTACT_FIELDS = Object.freeze(["personalEmail", "workEmail", "preferredEmail"]);

const IDENTITY_LINK_REASON = Object.freeze({
  PROFILE_BOUND_TO_OTHER_USER: "PROFILE_BOUND_TO_OTHER_USER",
  PROFILE_UNBOUND: "PROFILE_UNBOUND",
});

const plain = (o) => (o && typeof o.toObject === "function" ? o.toObject() : o || {});

/** contactInfo to write onto an existing profile: the applied values, identity emails kept. */
function preserveIdentityContact(profileContactInfo, appliedContactInfo) {
  const current = plain(profileContactInfo);
  const out = { ...(appliedContactInfo || {}) };
  for (const field of IDENTITY_CONTACT_FIELDS) {
    if (current[field] !== undefined && current[field] !== null && current[field] !== "") {
      out[field] = current[field];
    } else {
      delete out[field];
    }
  }
  return out;
}

/**
 * The pending identity-link record for an approval INTO an existing profile, or null when the
 * applicant has no portal identity or the profile is already bound to that same identity.
 * `applicantIds` = the applicant's identifiers (local synced User._id and/or user-service id).
 */
function pendingIdentityLink({ profile, applicantIds, applicationId, now = new Date() }) {
  const ids = (applicantIds || []).filter((v) => v != null && v !== "").map(String);
  if (!ids.length) return null;
  const bound = profile?.userId ? String(profile.userId) : null;
  if (bound && ids.includes(bound)) return null;
  return {
    status: "PENDING",
    reason: bound ? IDENTITY_LINK_REASON.PROFILE_BOUND_TO_OTHER_USER : IDENTITY_LINK_REASON.PROFILE_UNBOUND,
    applicationId: applicationId || null,
    profileId: profile?._id ? String(profile._id) : null,
    applicantUserId: ids[0],
    profileBound: !!bound,
    recordedAt: now,
  };
}

/**
 * Persist a pending identity-link request (idempotent per tenant + profile + applicant while
 * PENDING). `link` is a pendingIdentityLink() record. Returns the record (or null).
 */
async function recordPendingIdentityLink(link, { tenantId, source, matchedBy = [], session = null } = {}) {
  if (!link || link.status !== "PENDING" || !tenantId || !link.profileId || !link.applicantUserId) return null;
  const now = new Date();
  await requestModel().updateOne(
    { tenantId: String(tenantId), profileId: String(link.profileId), applicantUserId: String(link.applicantUserId), status: "PENDING" },
    {
      $setOnInsert: { recordedAt: link.recordedAt || now },
      $set: {
        reason: link.reason,
        profileBound: !!link.profileBound,
        lastSeenAt: now,
        ...(link.applicationId ? { applicationId: String(link.applicationId) } : {}),
      },
      $addToSet: { sources: source || "unknown", matchedBy: { $each: matchedBy } },
    },
    { upsert: true, ...(session ? { session } : {}) },
  ).catch((err) => {
    if (err?.code !== 11000) throw err; // a concurrent first insert won: same pending record
  });
  return link;
}

module.exports = {
  recordPendingIdentityLink,
  IDENTITY_CONTACT_FIELDS,
  IDENTITY_LINK_REASON,
  preserveIdentityContact,
  pendingIdentityLink,
};

"use strict";
/**
 * P5: approval never moves an existing profile's identity bindings.
 *
 * Incident shape: a LINK approval re-bound an existing member profile's Profile.userId (its portal
 * owner) to the applicant's portal user, so the original owner lost access to their own record
 * and the applicant gained it. Profile.userId is what portal object authorization uses
 * (middlewares/memberAccess.js resolveOwnProfile), so it is an access grant, not a data field.
 *
 * Rules (fail-closed default; the unbound-profile case is pending owner policy):
 *   - an approval never changes an existing Profile.userId, normalizedEmail or (once set)
 *     crmUserId, and LINK/MERGE never change the profile's login-relevant contact emails
 *     (personalEmail, workEmail, preferredEmail);
 *   - LINK/MERGE never binds the applicant's portal user to an existing profile, bound or
 *     unbound. The applicant identity stays on the application (its own userId is not
 *     rewritten either) and is recorded as a PENDING identity-link decision
 *     (PersonalDetails.identityLink) for an explicit, separate CRM decision.
 */

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

module.exports = {
  IDENTITY_CONTACT_FIELDS,
  IDENTITY_LINK_REASON,
  preserveIdentityContact,
  pendingIdentityLink,
};

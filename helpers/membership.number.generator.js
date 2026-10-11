const Profile = require("../models/profile.model");
const MembershipNumberSequence = require("../models/membershipNumberSequence.model");
const { requireTenantId } = require("./requireTenantId");

const YEAR_TO_ALPHABET = {
  2025: "A",
  2026: "B",
  2027: "C",
  2028: "D",
  2029: "E",
  2030: "F",
  2031: "G",
  2032: "H",
  2033: "I",
  2034: "J",
  2035: "K",
  2036: "L",
  2037: "M",
  2038: "N",
  2039: "O",
  2040: "P",
  2041: "Q",
  2042: "R",
  2043: "S",
  2044: "T",
  2045: "U",
  2046: "V",
  2047: "W",
  2048: "X",
  2049: "Y",
  2050: "Z",
};

// Function to get alphabet for current year
const getCurrentYearAlphabet = () => {
  const currentYear = new Date().getFullYear();
  return YEAR_TO_ALPHABET[currentYear] || "Z"; // Default to Z if year not in mapping
};

/** Highest numeric suffix already issued to this tenant for the letter (0 if none). */
const highestExistingSequence = async (tenantId, yearAlphabet) => {
  const highest = await Profile.findOne({
    tenantId,
    membershipNumber: { $regex: `^${yearAlphabet}\\d+$` },
  })
    .sort({ membershipNumber: -1 })
    .select({ membershipNumber: 1 })
    .lean();
  if (!highest || !highest.membershipNumber) return 0;
  const n = parseInt(highest.membershipNumber.substring(1), 10);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Next sequence for (tenant, letter), atomically. The counter is seeded once from the
 * tenant's current maximum with $max, which is idempotent and safe under concurrent
 * first use; after that every call is a single $inc. Runs outside any approval
 * transaction on purpose: an aborted approval leaves a gap, never a duplicate.
 */
const getNextSequenceNumber = async (tenantId, yearAlphabet) => {
  const filter = { tenantId, yearAlphabet };
  const seeded = await MembershipNumberSequence.exists(filter);
  if (!seeded) {
    const currentMax = await highestExistingSequence(tenantId, yearAlphabet);
    try {
      await MembershipNumberSequence.updateOne(
        filter,
        { $max: { seq: currentMax } },
        { upsert: true },
      );
    } catch (err) {
      // A concurrent first call created the row; $max below still applies.
      if (err?.code !== 11000) throw err;
      await MembershipNumberSequence.updateOne(filter, { $max: { seq: currentMax } });
    }
  }
  const row = await MembershipNumberSequence.findOneAndUpdate(
    filter,
    { $inc: { seq: 1 } },
    { new: true },
  ).lean();
  return row.seq;
};

/**
 * Next membership number for the tenant: "<year letter><5-digit sequence>", unique
 * within the tenant (Profile index { tenantId, membershipNumber }). Existing members are
 * never renumbered.
 */
const generateMembershipNumber = async (tenantId) => {
  const tid = String(requireTenantId(tenantId));
  const yearAlphabet = getCurrentYearAlphabet();
  const sequenceNumber = await getNextSequenceNumber(tid, yearAlphabet);
  const membershipNumber = `${yearAlphabet}${sequenceNumber.toString().padStart(5, "0")}`;
  console.log(`Generated membership number: ${membershipNumber}`);
  return membershipNumber;
};

module.exports = {
  generateMembershipNumber,
  getCurrentYearAlphabet,
};

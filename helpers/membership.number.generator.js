const Profile = require("../models/profile.model");

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

// Function to get the next sequence number for a given year alphabet
const getNextSequenceNumber = async (yearAlphabet) => {
  try {
    // Find the highest membership number for the current year from Profile
    const highestMembership = await Profile.findOne({
      membershipNumber: { $regex: `^${yearAlphabet}` },
    })
      .sort({ membershipNumber: -1 })
      .lean();

    if (!highestMembership || !highestMembership.membershipNumber) {
      // First membership for this year
      return 1;
    }

    // Extract the sequence number from the highest membership number
    const sequencePart = highestMembership.membershipNumber.substring(1);
    const currentSequence = parseInt(sequencePart, 10);

    return currentSequence + 1;
  } catch (error) {
    console.error("Error getting next sequence number:", error);
    throw error;
  }
};

// Main function to generate membership number
const generateMembershipNumber = async () => {
  try {
    const yearAlphabet = getCurrentYearAlphabet();
    const sequenceNumber = await getNextSequenceNumber(yearAlphabet);

    // Format sequence number to 5 digits (e.g., 00001, 00002, etc.)
    const formattedSequence = sequenceNumber.toString().padStart(5, "0");

    const membershipNumber = `${yearAlphabet}${formattedSequence}`;

    console.log(`Generated membership number: ${membershipNumber}`);
    return membershipNumber;
  } catch (error) {
    console.error("Error generating membership number:", error);
    throw error;
  }
};

module.exports = {
  generateMembershipNumber,
};

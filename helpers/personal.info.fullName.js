/**
 * Stored full name: forename + surname (trimmed), space-separated.
 */
function computeFullNameFromPersonalInfo(personalInfo = {}) {
  const parts = [personalInfo.forename, personalInfo.surname]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean);
  return parts.join(" ");
}

function stampPersonalInfoFullName(personalInfo) {
  if (!personalInfo || typeof personalInfo !== "object") return;
  personalInfo.fullName = computeFullNameFromPersonalInfo(personalInfo);
}

/** Mutates Mongoose update doc: top-level or $set.personalInfo */
function applyFullNameToMongooseUpdate(update) {
  if (!update || typeof update !== "object") return;
  const layer =
    update.$set != null && typeof update.$set === "object"
      ? update.$set
      : update;
  stampPersonalInfoFullName(layer.personalInfo);
}

/** Profile or PersonalDetails document / lean object with root personalInfo */
function enrichPersonalInfoFullNameOnDocument(doc) {
  if (!doc || typeof doc !== "object") return;
  const pi = doc.personalInfo;
  if (pi && typeof pi === "object") {
    stampPersonalInfoFullName(pi);
  }
}

function enrichPersonalInfoFullNameOnDocuments(docs) {
  if (!Array.isArray(docs)) return;
  for (const d of docs) enrichPersonalInfoFullNameOnDocument(d);
}

/** Application list/detail row: { personalDetails: doc | lean } */
function enrichApplicationRowPersonalFullName(row) {
  if (!row?.personalDetails) return;
  const pd = row.personalDetails;
  const pi = pd.personalInfo;
  if (pi && typeof pi === "object") {
    stampPersonalInfoFullName(pi);
  }
}

module.exports = {
  computeFullNameFromPersonalInfo,
  stampPersonalInfoFullName,
  applyFullNameToMongooseUpdate,
  enrichPersonalInfoFullNameOnDocument,
  enrichPersonalInfoFullNameOnDocuments,
  enrichApplicationRowPersonalFullName,
};

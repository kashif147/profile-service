const personalInfoKeys = [
  "title",
  "surname",
  "forename",
  "gender",
  "dateOfBirth",
  "age",
  "countryPrimaryQualification",
  "deceased",
  "deceasedDate",
];

const contactInfoKeys = [
  "nATA",
  "preferredAddress",
  "buildingOrHouse",
  "streetOrRoad",
  "areaOrTown",
  "eircode",
  "countyCityOrPostCode",
  "country",
  "fullAddress",
  "mobileNumber",
  "telephoneNumber",
  "preferredEmail",
  "personalEmail",
  "workEmail",
];

const professionalDetailsKeys = [
  "retiredDate",
  "pensionNo",
  "studyLocation",
  "startDate",
  "graduationDate",
  "workLocation",
  "payrollNo",
  "otherWorkLocation",
  "branch",
  "region",
  "grade",
  "otherGrade",
  "primarySection",
  "otherPrimarySection",
  "secondarySection",
  "otherSecondarySection",
  "nursingAdaptationProgramme",
  "nmbiNumber",
  "nurseType",
];

const preferencesKeys = ["consent", "valueAddedServices", "termsAndConditions"];

const cornmarketKeys = [
  "inmoRewards",
  "exclusiveDiscountsAndOffers",
  "incomeProtectionScheme",
];

const additionalInformationKeys = [
  "membershipStatus",
  "otherIrishTradeUnion",
  "otherIrishTradeUnionName",
  "otherScheme",
];

const recruitmentKeys = ["recuritedBy", "recuritedByMembershipNo"];

function pickSection(source = {}, keys = []) {
  const section = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source || {}, key)) {
      section[key] = source[key];
    }
  }
  return section;
}

function hasValues(obj = {}) {
  return Object.keys(obj).length > 0;
}

function flattenProfilePayload(effective = {}) {
  const payload = {};

  const personalInfo = pickSection(effective.personalInfo, personalInfoKeys);
  if (hasValues(personalInfo)) payload.personalInfo = personalInfo;

  const contactInfo = pickSection(effective.contactInfo, contactInfoKeys);
  if (hasValues(contactInfo)) payload.contactInfo = contactInfo;

  const professionalDetails = pickSection(
    effective.professionalDetails,
    professionalDetailsKeys
  );
  if (hasValues(professionalDetails))
    payload.professionalDetails = professionalDetails;

  const preferences = pickSection(effective.preferences, preferencesKeys);
  if (hasValues(preferences)) {
    payload.preferences = preferences;
  }

  const cornMarket = pickSection(effective.cornMarket, cornmarketKeys);
  if (hasValues(cornMarket)) {
    payload.cornMarket = cornMarket;
  }

	const additionalInformationSource = effective.additionalInformation || {};
  const additionalInformation = pickSection(
    additionalInformationSource,
    additionalInformationKeys
  );
  if (hasValues(additionalInformation)) {
    payload.additionalInformation = additionalInformation;
  }

	const recruitmentDetails = pickSection(effective.recruitmentDetails || {}, recruitmentKeys);
  if (hasValues(recruitmentDetails)) {
    payload.recruitmentDetails = recruitmentDetails;
  }

  return payload;
}

function cloneSection(section) {
  return section ? JSON.parse(JSON.stringify(section)) : {};
}

function rehydrateProfile(doc = {}) {
  const profile = doc.toObject ? doc.toObject() : doc;

  const personalInfo = cloneSection(profile.personalInfo);
  const contactInfo = cloneSection(profile.contactInfo);
  const professionalDetails = cloneSection(profile.professionalDetails);
  const preferences = cloneSection(profile.preferences);
  const cornMarket = cloneSection(profile.cornMarket);
  const additionalInformation = cloneSection(profile.additionalInformation);
  const recruitmentDetails = cloneSection(profile.recruitmentDetails);

  return {
    personalInfo,
    contactInfo,
    professionalDetails,
    preferences,
    cornMarket,
    additionalInformation,
    recruitmentDetails,
  };
}

module.exports = {
  flattenProfilePayload,
  rehydrateProfile,
  personalInfoKeys,
  contactInfoKeys,
  professionalDetailsKeys,
  preferencesKeys,
  cornmarketKeys,
  additionalInformationKeys,
  recruitmentKeys,
};

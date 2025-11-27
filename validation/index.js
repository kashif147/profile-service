const Joi = require("joi");
const { APPLICATION_STATUS, PREFERRED_ADDRESS, PREFERRED_EMAIL, PAYMENT_TYPE, PAYMENT_FREQUENCY } = require("../constants/enums");

module.exports.personal_details_create = Joi.object({
  personalInfo: Joi.object({
    title: Joi.string().optional().default(null),
    surname: Joi.string().optional().default(null),
    forename: Joi.string().optional().default(null),
    gender: Joi.string().optional().default(null),
    dateOfBirth: Joi.date().iso().optional().default(null),
    countryPrimaryQualification: Joi.string().optional().default(null),
    deceased: Joi.boolean().optional().default(false),
    deceasedDate: Joi.date().iso().optional().default(null),
  }).optional(),
  contactInfo: Joi.object({
    nATA: Joi.boolean().optional().default(false),
    preferredAddress: Joi.string()
      .valid(...Object.values(PREFERRED_ADDRESS))
      .optional()
      .default(null),
    eircode: Joi.string().optional().default(null),
    buildingOrHouse: Joi.string().optional().default(null),
    streetOrRoad: Joi.string().optional().default(null),
    areaOrTown: Joi.string().optional().default(null),
    countyCityOrPostCode: Joi.string().optional().default(null),
    country: Joi.string().optional().default(null),
    mobileNumber: Joi.string().optional().default(null),
    telephoneNumber: Joi.string().optional().allow(null).default(null),
    preferredEmail: Joi.string()
      .valid(...Object.values(PREFERRED_EMAIL))
      .optional()
      .default(null),
    personalEmail: Joi.string().optional().default(null),
    workEmail: Joi.string().optional().default(null),
    consent: Joi.boolean().optional().default(false),
  }),
});

module.exports.personal_details_update = Joi.object({
  personalInfo: Joi.object({
    title: Joi.string().optional().default(null),
    surname: Joi.string().optional().default(null),
    forename: Joi.string().optional().default(null),
    gender: Joi.string().optional().default(null),
    dateOfBirth: Joi.date().iso().optional().default(null),
    countryPrimaryQualification: Joi.string().optional().default(null),
    deceased: Joi.boolean().optional().default(false),
    deceasedDate: Joi.date().iso().optional().default(null),
  }).optional(),
  contactInfo: Joi.object({
    nATA: Joi.boolean().optional().default(false),
    preferredAddress: Joi.string()
      .valid(...Object.values(PREFERRED_ADDRESS))
      .optional()
      .default(null),
    eircode: Joi.string().optional().default(null),
    buildingOrHouse: Joi.string().optional().default(null),
    streetOrRoad: Joi.string().optional().default(null),
    areaOrTown: Joi.string().optional().default(null),
    countyCityOrPostCode: Joi.string().optional().default(null),
    country: Joi.string().optional().default(null),
    mobileNumber: Joi.string().optional().default(null),
    telephoneNumber: Joi.string().optional().allow(null).default(null),
    preferredEmail: Joi.string()
      .valid(...Object.values(PREFERRED_EMAIL))
      .optional()
      .default(null),
    personalEmail: Joi.string().optional().default(null),
    workEmail: Joi.string().optional().default(null),
    consent: Joi.boolean().optional().default(false),
  }),
});

module.exports.application_status_query = Joi.object({
  type: Joi.alternatives()
    .try(Joi.string().valid(...Object.values(APPLICATION_STATUS)), Joi.array().items(Joi.string().valid(...Object.values(APPLICATION_STATUS))))
    .optional(),
});

module.exports.application_approve = Joi.object({
  applicationStatus: Joi.string().valid(APPLICATION_STATUS.APPROVED, APPLICATION_STATUS.REJECTED).required(),
  comments: Joi.string().optional(),
});
//
module.exports.professional_details_create = Joi.object({
  professionalDetails: Joi.object({
    membershipCategory: Joi.any().strip(),
    workLocation: Joi.string().optional().default(null),
    otherWorkLocation: Joi.string().optional().default(null),
    grade: Joi.string().optional().default(null),
    otherGrade: Joi.string().optional().default(null),
    nmbiNumber: Joi.string().optional().default(null),
    nurseType: Joi.string().optional().default(null),
    nursingAdaptationProgramme: Joi.boolean().optional().default(false),
    region: Joi.string().optional().default(null),
    branch: Joi.string().optional().default(null),
    pensionNo: Joi.string().optional().default(null),
    isRetired: Joi.boolean().optional().default(false),
    retiredDate: Joi.date().iso().optional().default(null),
    studyLocation: Joi.string().optional().default(null),
    startDate: Joi.date().iso().optional().default(null),
    graduationDate: Joi.date().iso().optional().default(null),
    otherGraduationDate: Joi.date().iso().optional().default(null),
    discipline: Joi.string().optional().default(null),
    submissionDate: Joi.date().iso().optional().default(Date.now),
  }),
});

module.exports.professional_details_update = Joi.object({
  professionalDetails: Joi.object({
    membershipCategory: Joi.any().strip(),
    workLocation: Joi.string().optional().default(null),
    otherWorkLocation: Joi.string().optional().default(null),
    grade: Joi.string().optional().default(null),
    otherGrade: Joi.string().optional().default(null),
    nmbiNumber: Joi.string().optional().default(null),
    nurseType: Joi.string().optional().default(null),
    nursingAdaptationProgramme: Joi.boolean().optional().default(false),
    region: Joi.string().optional().default(null),
    branch: Joi.string().optional().default(null),
    pensionNo: Joi.string().optional().default(null),
    isRetired: Joi.boolean().optional().default(false),
    retiredDate: Joi.date().iso().optional().default(null),
    studyLocation: Joi.string().optional().default(null),
    startDate: Joi.date().iso().optional().default(null),
    graduationDate: Joi.date().iso().optional().default(null),
    otherGraduationDate: Joi.date().iso().optional().default(null),
    discipline: Joi.string().optional().default(null),
  }),
});

module.exports.subscription_details_create = Joi.object({
  subscriptionDetails: Joi.object({
    paymentType: Joi.string()
      .valid(...Object.values(PAYMENT_TYPE))
      .optional(),
    payrollNo: Joi.string().optional().default(null),
    membershipStatus: Joi.string().optional().default(null),
    otherIrishTradeUnion: Joi.boolean().optional().default(false),
    otherIrishTradeUnionName: Joi.string().optional().default(null),
    otherScheme: Joi.boolean().optional().default(false),
    recuritedBy: Joi.string().optional().default(null),
    recuritedByMembershipNo: Joi.string().optional().default(null),
    primarySection: Joi.string().optional().default(null),
    otherPrimarySection: Joi.string().optional().default(null),
    secondarySection: Joi.string().optional().default(null),
    otherSecondarySection: Joi.string().optional().default(null),
    incomeProtectionScheme: Joi.boolean().optional().default(false),
    inmoRewards: Joi.boolean().optional().default(false),
    exclusiveDiscountsAndOffers: Joi.boolean().optional().default(false),
    valueAddedServices: Joi.boolean().optional().default(false),
    termsAndConditions: Joi.boolean().optional().default(true),
    membershipCategory: Joi.string().optional().default(null),
    dateJoined: Joi.date().iso().optional().default(null),
    paymentFrequency: Joi.string()
      .valid(...Object.values(PAYMENT_FREQUENCY))
      .optional(),
  }),
});

module.exports.subscription_details_update = Joi.object({
  subscriptionDetails: Joi.object({
    paymentType: Joi.string()
      .valid(...Object.values(PAYMENT_TYPE))
      .optional(),
    payrollNo: Joi.string().optional().default(null),
    membershipStatus: Joi.string().optional().default(null),
    otherIrishTradeUnion: Joi.boolean().optional().default(false),
    otherIrishTradeUnionName: Joi.string().optional().default(null),
    otherScheme: Joi.boolean().optional().default(false),
    recuritedBy: Joi.string().optional().default(null),
    recuritedByMembershipNo: Joi.string().optional().default(null),
    primarySection: Joi.string().optional().default(null),
    otherPrimarySection: Joi.string().optional().default(null),
    secondarySection: Joi.string().optional().default(null),
    otherSecondarySection: Joi.string().optional().default(null),
    incomeProtectionScheme: Joi.boolean().optional().default(false),
    inmoRewards: Joi.boolean().optional().default(false),
    exclusiveDiscountsAndOffers: Joi.boolean().optional().default(false),
    valueAddedServices: Joi.boolean().optional().default(false),
    termsAndConditions: Joi.boolean().optional().default(true),
    membershipCategory: Joi.string().optional().default(null),
    dateJoined: Joi.date().iso().optional().default(null),
    paymentFrequency: Joi.string()
      .valid(...Object.values(PAYMENT_FREQUENCY))
      .optional(),
  }),
});

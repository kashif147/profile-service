// validation/params.validators.js
const { z } = require("zod");
const ApplicationParams = z.object({
  applicationId: z.string().min(1),
});

const DuplicateMergeCompareParams = ApplicationParams.extend({
  profileId: z.string().min(1),
});

module.exports = { ApplicationParams, DuplicateMergeCompareParams };

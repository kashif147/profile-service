const Profile = require("../models/profile.model");
const { normalizeEmail } = require("../helpers/profileLookup.service.js");

const CONTINUE_RESPONSE = { version: "1.0.0", action: "Continue" };
const DUPLICATE_MESSAGE =
  "A profile with this email already exists. Please sign in instead.";

function send(res, payload) {
  return res.status(200).json({ ...payload });
}

exports.validateProfile = async (req, res) => {
  try {
    const { email, tenantId, step, ...claims } = req.body || {};

    if (!email) {
      return send(res, {
        version: "1.0.0",
        action: "ValidationError",
        userMessage: "Email is required.",
      });
    }

    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return send(res, {
        version: "1.0.0",
        action: "ValidationError",
        userMessage: "Email is invalid.",
      });
    }

    const query = { normalizedEmail };
    if (tenantId) query.tenantId = tenantId;

    const existingProfile = await Profile.findOne(query).lean().exec();

    if (existingProfile) {
      return send(res, {
        version: "1.0.0",
        action: "ValidationError",
        userMessage: DUPLICATE_MESSAGE,
      });
    }

    return send(res, {
      ...CONTINUE_RESPONSE,
      email,
      ...(tenantId && { tenantId }),
      ...(step && { step }),
      ...claims,
    });
  } catch (error) {
    console.error("profile.validate error", error);
    return send(res, {
      version: "1.0.0",
      action: "ValidationError",
      userMessage: "An error occurred during validation. Please try again.",
    });
  }
};


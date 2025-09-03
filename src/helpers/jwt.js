import jwt from "jsonwebtoken";

export function generateToken(user) {
  return {
    token:
      "Bearer " +
      jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRY,
      }),
    user,
  };
}

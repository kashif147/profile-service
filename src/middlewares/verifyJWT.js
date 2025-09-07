import jwt from "jsonwebtoken";

const verifyJWT = (req, res, next) => {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header?.startsWith("Bearer ")) return res.fail("Unauthorized");
  const token = header.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      console.error("JWT Verification Error:", err.message);
      return res.fail("Unauthorized");
    }

    req.user = {
      id: decoded.id,
      role: decoded.role,
      tenantId: decoded.tenantId,
    };
    req.tenantId = decoded.tenantId;
    next();
  });
};

export default verifyJWT;

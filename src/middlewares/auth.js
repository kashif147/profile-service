import jwt from "jsonwebtoken";
import ROLES_LIST from "../config/roles.js";

export async function ensureAuthenticated(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.fail("Unauthorized");
  try {
    const decoded = jwt.verify(
      token.replace("Bearer ", ""),
      process.env.JWT_SECRET
    );
    req.user = {
      id: decoded.id,
      role: decoded.role,
      tenantId: decoded.tenantId,
    }; // adjust per issuer
    req.tenantId = decoded.tenantId;
    return next();
  } catch (e) {
    console.error("JWT failed:", e.message);
    return res.fail("Unauthorized");
  }
}
function val(role) {
  if (typeof role === "number") return role;
  return ROLES_LIST[role] ?? -1;
}
export function authorizeAny(...roles) {
  const allowed = roles.map(val).filter((v) => v >= 0);
  return (req, res, next) =>
    allowed.includes(val(req.user?.role)) ? next() : res.fail("Forbidden");
}
export function authorizeMin(minRole) {
  const min = val(minRole);
  return (req, res, next) =>
    val(req.user?.role) >= min ? next() : res.fail("Forbidden");
}

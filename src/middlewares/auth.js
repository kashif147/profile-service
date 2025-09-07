import jwt from "jsonwebtoken";
import ROLES_LIST from "../config/roles.js";
import PERMISSIONS from "@membership/shared-constants/permissions";

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

// Permission-based authorization middleware
export function requirePermission(requiredPermission) {
  return (req, res, next) => {
    if (!req.user || !req.user.permissions) {
      return res.fail("Authentication required");
    }

    // Check if user has the required permission
    const hasPermission =
      req.user.permissions.includes(requiredPermission) ||
      req.user.permissions.includes("*"); // Super user has all permissions

    if (!hasPermission) {
      return res.fail("Insufficient permissions");
    }

    next();
  };
}

// Require any of multiple permissions
export function requireAnyPermission(...requiredPermissions) {
  return (req, res, next) => {
    if (!req.user || !req.user.permissions) {
      return res.fail("Authentication required");
    }

    // Check if user has any of the required permissions
    const hasAnyPermission = requiredPermissions.some(
      (permission) =>
        req.user.permissions.includes(permission) ||
        req.user.permissions.includes("*")
    );

    if (!hasAnyPermission) {
      return res.fail("Insufficient permissions");
    }

    next();
  };
}

// Export permissions for use in routes
export { PERMISSIONS };

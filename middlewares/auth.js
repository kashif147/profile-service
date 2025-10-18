const jwt = require("jsonwebtoken");
const { AppError } = require("../errors/AppError");

/**
 * Unified JWT Authentication Middleware
 * Handles JWT token verification and sets request context
 *
 * This middleware ONLY verifies JWT tokens and extracts user context.
 * All authorization decisions are made by the user-service PDP.
 */
const authenticate = async (req, res, next) => {
  try {
    console.log("=== AUTH MIDDLEWARE START ===");
    console.log("JWT_SECRET exists:", !!process.env.JWT_SECRET);
    console.log("AUTH_BYPASS_ENABLED:", process.env.AUTH_BYPASS_ENABLED);
    console.log("Request headers:", req.headers);

    // Check if auth bypass is enabled
    if (process.env.AUTH_BYPASS_ENABLED === 'true') {
      console.log("=== AUTH BYPASS ENABLED - SKIPPING JWT VERIFICATION ===");
      
      // Set default bypass context
      req.ctx = {
        tenantId: 'bypass-tenant',
        userId: 'bypass-user',
        roles: ['SU'], // Super User role for bypass
        permissions: ['*'], // All permissions for bypass
      };

      // Attach user info for backward compatibility
      req.user = {
        sub: 'bypass-user',
        id: 'bypass-user',
        tenantId: 'bypass-tenant',
        userType: 'CRM', // Default to CRM for bypass
        roles: ['SU'],
        permissions: ['*']
      };
      req.userId = 'bypass-user';
      req.tenantId = 'bypass-tenant';
      req.roles = ['SU'];
      req.permissions = ['*'];

      console.log("=== AUTH BYPASS SUCCESS ===");
      console.log("Bypass context set:", {
        userId: req.userId,
        tenantId: req.tenantId,
        userType: req.user?.userType,
      });
      return next();
    }

    const authHeader = req.headers.authorization || req.headers.Authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("Missing or invalid authorization header");
      const authError = AppError.badRequest("Authorization header required", {
        tokenError: true,
        missingHeader: true,
      });
      return res.status(authError.status).json({
        error: {
          message: authError.message,
          code: authError.code,
          status: authError.status,
          tokenError: authError.tokenError,
          missingHeader: authError.missingHeader,
        },
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer '
    console.log("Token (first 20 chars):", token.substring(0, 20) + "...");

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET environment variable is not set!");
      throw new Error("JWT_SECRET environment variable is required");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("JWT decoded successfully:", {
      sub: decoded.sub,
      id: decoded.id,
      tenantId: decoded.tenantId,
      userType: decoded.userType,
    });

    // Extract tenantId from token - support both tid and tenantId claims
    const tenantId =
      decoded.tenantId || decoded.tid || decoded.extension_tenantId;

    // Validate tenantId is present in token
    if (!tenantId) {
      const authError = AppError.badRequest("Invalid token: missing tenantId", {
        tokenError: true,
        missingTenantId: true,
      });
      return res.status(authError.status).json({
        error: {
          message: authError.message,
          code: authError.code,
          status: authError.status,
          tokenError: authError.tokenError,
          missingTenantId: authError.missingTenantId,
        },
      });
    }

    // Set request context with tenant isolation
    req.ctx = {
      tenantId: tenantId,
      userId: decoded.sub || decoded.id, // Support both sub and id claims
      roles: decoded.roles || [],
      permissions: decoded.permissions || [],
    };

    // Attach user info to request for backward compatibility
    req.user = decoded;
    req.userId = decoded.sub || decoded.id;
    req.tenantId = tenantId;
    req.roles = decoded.roles || [];
    req.permissions = decoded.permissions || [];

    console.log("=== AUTH MIDDLEWARE SUCCESS ===");
    console.log("Request context set:", {
      userId: req.userId,
      tenantId: req.tenantId,
      userType: req.user?.userType,
    });
    next();
  } catch (error) {
    console.error("JWT Verification Error:", error.message);
    const authError = AppError.badRequest("Invalid token", {
      tokenError: true,
      jwtError: error.message,
    });
    return res.status(authError.status).json({
      error: {
        message: authError.message,
        code: authError.code,
        status: authError.status,
        tokenError: authError.tokenError,
        jwtError: authError.jwtError,
      },
    });
  }
};

// Helper function to check if user has any of the specified roles
function hasAnyRole(userRoles, requiredRoles) {
  if (!userRoles || !Array.isArray(userRoles)) return false;

  // Handle both role objects and role codes
  const userRoleCodes = userRoles.map((role) =>
    typeof role === "string" ? role : role.code
  );

  return requiredRoles.some((role) => userRoleCodes.includes(role));
}

// Helper function to check if user has specific role
function hasRole(userRoles, requiredRole) {
  if (!userRoles || !Array.isArray(userRoles)) return false;

  // Handle both role objects and role codes
  const userRoleCodes = userRoles.map((role) =>
    typeof role === "string" ? role : role.code
  );

  return userRoleCodes.includes(requiredRole);
}

/**
 * Role-based Authorization Middleware
 * Requires user to have any of the specified roles
 *
 * Note: This is a simple role check. For complex authorization,
 * use the policy middleware that delegates to user-service PDP.
 */
const requireRole = (requiredRoles) => {
  return (req, res, next) => {
    if (!req.ctx || !req.ctx.roles) {
      const authError = AppError.badRequest("Authentication required", {
        authError: true,
        missingRoles: true,
      });
      return res.status(authError.status).json({
        error: {
          message: authError.message,
          code: authError.code,
          status: authError.status,
          authError: authError.authError,
          missingRoles: authError.missingRoles,
        },
      });
    }

    // Super User has access to everything
    if (req.ctx.roles && req.ctx.roles.includes("SU")) {
      return next();
    }

    const hasRequiredRole = hasAnyRole(req.ctx.roles, requiredRoles);

    if (!hasRequiredRole) {
      const forbiddenError = AppError.badRequest("Insufficient permissions", {
        forbidden: true,
        userRoles: req.ctx.roles,
        requiredRoles: requiredRoles,
      });
      return res.status(forbiddenError.status).json({
        error: {
          message: forbiddenError.message,
          code: forbiddenError.code,
          status: forbiddenError.status,
          forbidden: forbiddenError.forbidden,
          userRoles: forbiddenError.userRoles,
          requiredRoles: forbiddenError.requiredRoles,
        },
      });
    }

    next();
  };
};

/**
 * Permission-based Authorization Middleware
 * Requires user to have any of the specified permissions
 *
 * Note: This is a simple permission check. For complex authorization,
 * use the policy middleware that delegates to user-service PDP.
 */
const requirePermission = (requiredPermissions) => {
  return (req, res, next) => {
    if (!req.ctx || !req.ctx.permissions) {
      const authError = AppError.badRequest("Authentication required", {
        authError: true,
        missingPermissions: true,
      });
      return res.status(authError.status).json({
        error: {
          message: authError.message,
          code: authError.code,
          status: authError.status,
          authError: authError.authError,
          missingPermissions: authError.missingPermissions,
        },
      });
    }

    // Super User has all permissions
    if (req.ctx.roles && req.ctx.roles.includes("SU")) {
      return next();
    }

    const hasRequiredPermission = requiredPermissions.some(
      (permission) =>
        req.ctx.permissions.includes(permission) ||
        req.ctx.permissions.includes("*")
    );

    if (!hasRequiredPermission) {
      const forbiddenError = AppError.badRequest("Insufficient permissions", {
        forbidden: true,
        userPermissions: req.ctx.permissions,
        requiredPermissions: requiredPermissions,
      });
      return res.status(forbiddenError.status).json({
        error: {
          message: forbiddenError.message,
          code: forbiddenError.code,
          status: forbiddenError.status,
          forbidden: forbiddenError.forbidden,
          userPermissions: forbiddenError.userPermissions,
          requiredPermissions: forbiddenError.requiredPermissions,
        },
      });
    }

    next();
  };
};

/**
 * Tenant Enforcement Middleware
 * Ensures tenantId is present in req.ctx
 */
const requireTenant = (req, res, next) => {
  if (!req.ctx || !req.ctx.tenantId) {
    const authError = AppError.badRequest("Tenant context required", {
      authError: true,
      missingTenant: true,
    });
    return res.status(authError.status).json({
      error: {
        message: authError.message,
        code: authError.code,
        status: authError.status,
        authError: authError.authError,
        missingTenant: authError.missingTenant,
      },
    });
  }
  next();
};

/**
 * Helper function to add tenantId to MongoDB queries
 */
const withTenant = (tenantId) => {
  return { tenantId };
};

/**
 * Helper function to add tenantId to MongoDB aggregation pipelines
 */
const addTenantMatch = (tenantId) => {
  return { $match: { tenantId } };
};

// Export all middleware functions
module.exports = {
  // Core authentication
  authenticate,

  // Authorization middleware (simple checks only)
  requireRole,
  requirePermission,
  requireTenant,

  // Utility functions
  hasRole,
  hasAnyRole,

  // Database helpers
  withTenant,
  addTenantMatch,
};

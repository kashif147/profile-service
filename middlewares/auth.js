const jwt = require("jsonwebtoken");
const { AppError } = require("../errors/AppError");
const { gatewaySecurity } = require("@membership/policy-middleware/security");
const { validateGatewayRequest } = gatewaySecurity;

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
    console.log("AUTH_BYPASS_ENABLED:", process.env.AUTH_BYPASS_ENABLED);
    console.log("Request headers:", Object.keys(req.headers));

    // 1) Check for gateway-verified JWT (trust gateway headers with validation)
    const jwtVerified = req.headers["x-jwt-verified"];
    const authSource = req.headers["x-auth-source"];

    if (jwtVerified === "true" && authSource === "gateway") {
      // Validate gateway request (signature, IP, format)
      const validation = validateGatewayRequest(req);
      if (!validation.valid) {
        console.warn("Gateway header validation failed:", validation.reason);
        const authError = AppError.unauthorized("Invalid gateway request", {
          tokenError: true,
          validationError: validation.reason,
        });
        return res.status(authError.status).json({
          error: {
            message: authError.message,
            code: authError.code,
            status: authError.status,
            tokenError: authError.tokenError,
            validationError: authError.validationError,
          },
        });
      }

      // Gateway has verified JWT and forwarded claims as headers
      const userId = req.headers["x-user-id"];
      const tenantId = req.headers["x-tenant-id"];
      const userEmail = req.headers["x-user-email"];
      const userType = req.headers["x-user-type"];
      const userRolesStr = req.headers["x-user-roles"] || "[]";
      const userPermissionsStr = req.headers["x-user-permissions"] || "[]";

      if (!userId || !tenantId) {
        const authError = AppError.badRequest(
          "Missing required authentication headers",
          {
            tokenError: true,
            missingHeaders: true,
          }
        );
        return res.status(authError.status).json({
          error: {
            message: authError.message,
            code: authError.code,
            status: authError.status,
            tokenError: authError.tokenError,
            missingHeaders: authError.missingHeaders,
          },
        });
      }

      let roles = [];
      let permissions = [];

      try {
        const rolesArray = JSON.parse(userRolesStr);
        roles = Array.isArray(rolesArray)
          ? rolesArray
              .map((role) => (typeof role === "string" ? role : role?.code))
              .filter(Boolean)
          : [];
      } catch (e) {
        console.warn("Failed to parse x-user-roles header:", e.message);
      }

      try {
        permissions = JSON.parse(userPermissionsStr);
        if (!Array.isArray(permissions)) permissions = [];
      } catch (e) {
        console.warn("Failed to parse x-user-permissions header:", e.message);
      }

      // Set request context with tenant isolation
      req.ctx = {
        tenantId,
        userId,
        roles,
        permissions,
      };

      // Attach user info to request for backward compatibility
      req.user = {
        sub: userId,
        id: userId,
        tenantId,
        email: userEmail,
        userType,
        roles,
        permissions,
      };

      req.userId = userId;
      req.tenantId = tenantId;
      req.roles = roles;
      req.permissions = permissions;

      console.log("=== AUTH MIDDLEWARE SUCCESS (Gateway) ===");
      console.log("Request context set:", {
        userId: req.userId,
        tenantId: req.tenantId,
        userType: req.user?.userType,
      });
      return next();
    }

    // 2) Check if auth bypass is enabled (legacy support)
    if (process.env.AUTH_BYPASS_ENABLED === "true") {
      console.log(
        "=== AUTH BYPASS ENABLED - Will skip authorization but still validate token ==="
      );

      // Check if this is an authentication endpoint - bypass should NEVER be used for these
      const authEndpoints = [
        "/login",
        "/signin",
        "/signup",
        "/register",
        "/auth",
      ];
      const isAuthEndpoint = authEndpoints.some((endpoint) =>
        req.path.toLowerCase().includes(endpoint.toLowerCase())
      );

      if (isAuthEndpoint) {
        console.error(
          "=== SECURITY ERROR: Bypass attempted on authentication endpoint ==="
        );
        console.error("Path:", req.path);
        const authError = AppError.badRequest(
          "Authentication bypass is not allowed for authentication endpoints",
          {
            tokenError: true,
            securityError: true,
          }
        );
        return res.status(authError.status).json({
          error: {
            message: authError.message,
            code: authError.code,
            status: authError.status,
            tokenError: authError.tokenError,
            securityError: authError.securityError,
          },
        });
      }

      // For non-auth endpoints, still validate token but skip authorization checks
      const authHeader = req.headers.authorization || req.headers.Authorization;

      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7);
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);

          const tenantId =
            decoded.tenantId || decoded.tid || decoded.extension_tenantId;

          if (!tenantId) {
            const authError = AppError.badRequest(
              "Invalid token: missing tenantId",
              {
                tokenError: true,
                missingTenantId: true,
              }
            );
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

          req.ctx = {
            tenantId: tenantId,
            userId: decoded.sub || decoded.id,
            roles: decoded.roles || [],
            permissions: decoded.permissions || [],
          };

          req.user = decoded;
          req.userId = decoded.sub || decoded.id;
          req.tenantId = tenantId;
          req.roles = decoded.roles || [];
          req.permissions = decoded.permissions || [];

          console.log("=== AUTH BYPASS: Using token context ===");
          return next();
        } catch (error) {
          console.error("JWT Verification Error during bypass:", error.message);
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
      } else {
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
    }

    // 3) Legacy Bearer JWT flow (fallback for direct service calls)
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

    const token = authHeader.substring(7);
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

    const tenantId =
      decoded.tenantId || decoded.tid || decoded.extension_tenantId;

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

    if (!decoded.userType) {
      console.warn(
        "WARNING: JWT token missing userType claim. This may cause authorization failures."
      );
    }

    req.ctx = {
      tenantId: tenantId,
      userId: decoded.sub || decoded.id,
      roles: decoded.roles || [],
      permissions: decoded.permissions || [],
    };

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
  ensureAuthenticated: authenticate, // Alias for backward compatibility

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

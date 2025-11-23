const cors = require("cors");

/**
 * CORS Configuration for Microservice Architecture
 * Handles cross-origin requests from multiple frontend applications
 */

// Environment-based CORS configuration
const getCorsConfig = () => {
  const environment = process.env.NODE_ENV || "development";

  // Base allowed origins for different environments
  const baseOrigins = {
    development: [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
      "http://localhost:8080",
      "http://localhost:8081",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
    ],
    staging: [
      "http://localhost:3000",
      "https://profileserviceshell-bqfmh8apf9erf0b0.northeurope-01.azurewebsites.net",
      "https://userserviceshell-aqf6f0b8fqgmagch.canadacentral-01.azurewebsites.net",
      "https://projectshellapi-c0hqhbdwaaahbcab.northeurope-01.azurewebsites.net",
      "https://staging-admin.yourdomain.com",
      "https://staging-mobile.yourdomain.com",
    ],
    production: [
      "https://app.yourdomain.com",
      "https://admin.yourdomain.com",
      "https://mobile.yourdomain.com",
      "https://project-shell-portal.vercel.app",
    ],
  };

  // Add profile-service URL to allowed origins
  const profileServiceUrl = process.env.profile_SERVICE_URL;
  if (
    profileServiceUrl &&
    !baseOrigins[environment].includes(profileServiceUrl)
  ) {
    baseOrigins[environment].push(profileServiceUrl);
  }

  // Get additional origins from environment variables
  const additionalOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];

  // Validate additional origins (basic URL validation)
  const validAdditionalOrigins = additionalOrigins.filter((origin) => {
    const trimmed = origin.trim();
    if (!trimmed) return false;

    // Basic URL validation
    try {
      const url = new URL(trimmed);
      return ["http:", "https:"].includes(url.protocol);
    } catch {
      console.warn(`Invalid origin in ALLOWED_ORIGINS: ${trimmed}`);
      return false;
    }
  });

  // Combine base origins with additional ones
  const allowedOrigins = [
    ...(baseOrigins[environment] || baseOrigins.development),
    ...validAdditionalOrigins,
  ];

  // Remove duplicates
  const uniqueOrigins = [...new Set(allowedOrigins)];

  return {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman, etc.)
      if (!origin) {
        return callback(null, true);
      }

      // Check if origin is in allowed list
      if (uniqueOrigins.includes(origin)) {
        callback(null, true);
      } else {
        // Check if origin matches Vercel domain pattern
        // Vercel domains: *.vercel.app (e.g., project-shell-portal.vercel.app)
        const vercelPattern = /^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/;
        if (vercelPattern.test(origin)) {
          callback(null, true);
          return;
        }

        // Log blocked origins for debugging
        console.warn(`CORS blocked origin: ${origin}`);
        console.log(`Allowed origins: ${uniqueOrigins.join(", ")}`);
        callback(new Error(`Not allowed by CORS. Origin: ${origin}`));
      }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    allowedHeaders: [
      "Origin",
      "X-Requested-With",
      "Content-Type",
      "Accept",
      "Authorization",
      "X-Request-ID",
      "X-Correlation-ID",
      "X-Tenant-ID",
      "X-User-ID",
      "Cache-Control",
      "Pragma",
      "maxbodylength",
    ],
    exposedHeaders: [
      "X-Request-ID",
      "X-Correlation-ID",
      "X-Total-Count",
      "X-Page-Count",
    ],
    maxAge: 86400, // 24 hours
  };
};

// Create CORS middleware
const corsMiddleware = cors(getCorsConfig());

// Preflight handler for OPTIONS requests
const handlePreflight = (req, res, next) => {
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Origin", req.headers.origin);
    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD"
    );
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Request-ID, X-Correlation-ID, X-Tenant-ID, X-User-ID, Cache-Control, Pragma, maxbodylength"
    );
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Max-Age", "86400");
    return res.status(200).end();
  }
  next();
};

// CORS error handler
const corsErrorHandler = (err, req, res, next) => {
  if (err.message && err.message.includes("Not allowed by CORS")) {
    const corsConfig = getCorsConfig();
    const environment = process.env.NODE_ENV || "development";

    // Get the actual allowed origins for this environment
    const baseOrigins = {
      development: [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://localhost:8080",
        "http://localhost:8081",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
      ],
      staging: [
        "http://localhost:3000",
        "https://profileserviceshell-bqfmh8apf9erf0b0.northeurope-01.azurewebsites.net",
        "https://userserviceshell-aqf6f0b8fqgmagch.canadacentral-01.azurewebsites.net",
        "https://projectshellapi-c0hqhbdwaaahbcab.northeurope-01.azurewebsites.net",
        "https://staging-admin.yourdomain.com",
        "https://staging-mobile.yourdomain.com",
      ],
      production: [
        "https://app.yourdomain.com",
        "https://admin.yourdomain.com",
        "https://mobile.yourdomain.com",
        "https://project-shell-portal.vercel.app",
      ],
    };

    const additionalOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];

    // Validate additional origins (same logic as main function)
    const validAdditionalOrigins = additionalOrigins.filter((origin) => {
      const trimmed = origin.trim();
      if (!trimmed) return false;

      try {
        const url = new URL(trimmed);
        return ["http:", "https:"].includes(url.protocol);
      } catch {
        return false;
      }
    });

    const allowedOrigins = [
      ...(baseOrigins[environment] || baseOrigins.development),
      ...validAdditionalOrigins,
    ];

    return res.status(403).json({
      error: {
        message: "CORS policy violation",
        code: "CORS_ERROR",
        status: 403,
        details:
          process.env.NODE_ENV === "development"
            ? err.message
            : "Cross-origin request blocked",
        allowedOrigins:
          process.env.NODE_ENV === "development"
            ? [...new Set(allowedOrigins)]
            : undefined,
      },
    });
  }
  next(err);
};

module.exports = {
  corsMiddleware,
  handlePreflight,
  corsErrorHandler,
  getCorsConfig,
};

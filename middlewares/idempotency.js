const crypto = require("crypto");

/**
 * Idempotency middleware to prevent duplicate operations
 * Uses request body hash + user ID to create unique keys
 */
function idempotency(options = {}) {
  const {
    ttl = 300000, // 5 minutes default TTL
    keyGenerator = defaultKeyGenerator,
    store = new Map(), // In-memory store (not production ready)
  } = options;

  return (req, res, next) => {
    const key = keyGenerator(req);

    if (store.has(key)) {
      const cached = store.get(key);
      if (Date.now() - cached.timestamp < ttl) {
        return res.status(200).json(cached.response);
      } else {
        store.delete(key);
      }
    }

    // Store original res.json
    const originalJson = res.json;

    res.json = function (data) {
      // Cache successful responses (2xx status codes)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        store.set(key, {
          response: data,
          timestamp: Date.now(),
        });
      }

      return originalJson.call(this, data);
    };

    next();
  };
}

/**
 * Default key generator using user ID + request body hash
 */
function defaultKeyGenerator(req) {
  const userId = req.user?.id || req.userId || "anonymous";
  const bodyHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(req.body || {}))
    .digest("hex")
    .substring(0, 16);

  return `${userId}:${req.method}:${req.path}:${bodyHash}`;
}

module.exports = { idempotency };

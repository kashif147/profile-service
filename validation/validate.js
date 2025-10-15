const { ZodError } = require("zod");

/**
 * Flexible validator for Express using Zod.
 *
 * Usage patterns:
 *  1) validate(schema)                     -> validates req.body against `schema`
 *  2) validate({ body, params, query })    -> validates multiple parts at once
 *  3) validate({ headers })                -> validates headers (normalized to lowercase keys)
 *
 * On failure: returns 400 with a compact list of messages.
 * On success: replaces req.body/params/query/headers with parsed data (safe, coerced).
 */
function validate(schemas) {
  // Normalize to object form so we can support body/params/query/headers
  const normalized =
    typeof schemas?.safeParse === "function"
      ? { body: schemas } // single schema -> body
      : schemas || {};

  return (req, res, next) => {
    try {
      const results = {};
      const errors = [];

      // Prepare candidates
      const candidates = {
        body: normalized.body ? req.body : undefined,
        params: normalized.params ? req.params : undefined,
        query: normalized.query ? req.query : undefined,
        headers: normalized.headers
          ? Object.fromEntries(
              Object.entries(req.headers || {}).map(([k, v]) => [
                k.toLowerCase(),
                v,
              ])
            )
          : undefined,
      };

      // Validate each provided schema
      for (const [part, schema] of Object.entries(normalized)) {
        if (!schema) continue;

        const data = candidates[part];
        const result = schema.safeParse(data);

        if (!result.success) {
          errors.push(...flattenZodErrors(result.error, part));
        } else {
          results[part] = result.data; // keep the parsed (coerced) values
        }
      }

      if (errors.length) {
        return res.status(400).json({
          status: "fail",
          data: errors,
        });
      }

      // Overwrite with parsed payloads only where applicable
      if (results.body) req.body = results.body;
      if (results.params) req.params = results.params;
      if (results.query) req.query = results.query;
      if (results.headers) req.headers = { ...req.headers, ...results.headers };

      return next();
    } catch (e) {
      return next(e);
    }
  };
}

/**
 * Turns a ZodError into a compact array of strings like:
 *   "body.personalInfo.surname: Required"
 */
function flattenZodErrors(error, partLabel) {
  if (!(error instanceof ZodError)) return ["Invalid payload"];
  return error.issues.map((iss) => {
    const path =
      iss.path && iss.path.length
        ? `${partLabel}.${iss.path.join(".")}`
        : partLabel;
    return `${path}: ${iss.message}`;
  });
}

module.exports = { validate };

export function errorMiddleware(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal error";
  if (status >= 500) console.error(err);
  res
    .status(status)
    .json({ error: status === 404 ? "NOT_FOUND" : "ERROR", message });
}

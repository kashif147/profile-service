export default function loggerMiddleware(req, res, next) {
  console.log(`${req.method} ${req.url}`);
  if (
    ["POST", "PUT", "PATCH"].includes(req.method) &&
    req.body &&
    Object.keys(req.body).length
  ) {
    console.log("BODY:", JSON.stringify(req.body).slice(0, 2000));
  }
  next();
}

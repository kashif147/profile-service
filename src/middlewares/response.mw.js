export default function responseMiddleware(req, res, next) {
  res.success = (data) => res.status(200).json({ status: "success", data });
  res.fail = (data) => res.status(400).json({ status: "fail", data });
  next();
}

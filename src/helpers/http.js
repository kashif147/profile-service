export function ok(res, data) {
  return res.status(200).json(data);
}

export function fail(res, message) {
  return res.status(400).json({ message });
}

export function notFound(res, message) {
  return res.status(404).json({ message });
}

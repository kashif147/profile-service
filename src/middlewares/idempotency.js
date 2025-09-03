const mem = new Map();
export function idempotency() {
  return (req, res, next) => {
    const key = req.header("Idempotency-Key");
    if (!key) return next();
    if (mem.has(key)) return res.status(200).json(mem.get(key));
    const orig = res.json.bind(res);
    res.json = (body) => {
      mem.set(key, body);
      setTimeout(() => mem.delete(key), 300000);
      return orig(body);
    };
    next();
  };
}

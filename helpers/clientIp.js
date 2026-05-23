function firstPublicIpFromForwarded(forwarded) {
  if (!forwarded || typeof forwarded !== "string") return null;
  const parts = forwarded.split(",").map((p) => p.trim());
  for (const ip of parts) {
    if (!ip) continue;
    if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip === "127.0.0.1") {
      continue;
    }
    return ip;
  }
  return parts[0] || null;
}

function resolveClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const fromForwarded = firstPublicIpFromForwarded(forwarded);
  if (fromForwarded) {
    return { clientIp: fromForwarded, ipSource: "x-forwarded-for" };
  }
  const realIp = req.headers["x-real-ip"];
  if (realIp && typeof realIp === "string") {
    return { clientIp: realIp.trim(), ipSource: "x-real-ip" };
  }
  const socketIp = req.socket?.remoteAddress || req.connection?.remoteAddress;
  return {
    clientIp: socketIp ? String(socketIp).replace(/^::ffff:/, "") : null,
    ipSource: "socket",
  };
}

module.exports = { resolveClientIp };

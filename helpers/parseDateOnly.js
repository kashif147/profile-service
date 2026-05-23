/**
 * Calendar date → UTC noon Date for MongoDB (avoids timezone day-shift on read).
 * Prefer YYYY-MM-DD on the wire; also accepts DD/MM/YYYY and legacy ISO datetimes.
 */
function parseDateOnlyToUtcNoon(value, fallbackNow = false) {
  if (value == null || value === "") {
    if (!fallbackNow) return null;
    const now = new Date();
    return new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        12,
        0,
        0,
        0
      )
    );
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return fallbackNow ? new Date() : null;
    return new Date(
      Date.UTC(
        value.getUTCFullYear(),
        value.getUTCMonth(),
        value.getUTCDate(),
        12,
        0,
        0,
        0
      )
    );
  }
  const raw = String(value).trim();
  if (!raw) return fallbackNow ? new Date() : null;

  const dmyMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch;
    return new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0)
    );
  }

  // Pure calendar date only — do not use split("T")[0] on ISO datetimes (UTC day ≠ user day).
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return fallbackNow ? new Date() : null;
  // Legacy ISO datetimes: use local calendar date (matches user-selected day in CRM TZ).
  return new Date(
    Date.UTC(
      parsed.getFullYear(),
      parsed.getMonth(),
      parsed.getDate(),
      12,
      0,
      0,
      0
    )
  );
}

function normalizeSubscriptionDetailsDates(subscriptionDetails = {}) {
  const out = { ...subscriptionDetails };
  if (out.dateJoined != null && out.dateJoined !== "") {
    out.dateJoined = parseDateOnlyToUtcNoon(out.dateJoined, false);
  }
  if (out.submissionDate != null && out.submissionDate !== "") {
    out.submissionDate = parseDateOnlyToUtcNoon(out.submissionDate, false);
  }
  return out;
}

module.exports = {
  parseDateOnlyToUtcNoon,
  normalizeSubscriptionDetailsDates,
};

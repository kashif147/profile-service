const path = require("path");

/**
 * Flat INMO PDFs (no AcroForm fields) — text is drawn at configurable coordinates
 * (PDF user space, origin bottom-left). Override via env to align with your print layout.
 */
function numEnv(key, defaultVal) {
  const v = process.env[key];
  if (v == null || v === "") return defaultVal;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultVal;
}

/** Checkbox tick positions per frequency (PDF user space, bottom-left origin). Override via FORM_* env. */
const FREQ_ENV_SUFFIX = {
  Weekly: "WEEKLY",
  Fortnightly: "FORTNIGHTLY",
  Monthly: "MONTHLY",
  Quarterly: "QUARTERLY",
  Annually: "ANNUALLY",
};

/** Approximate defaults — tune with MEMBERSHIP_FORM_* PDF or FORM_* env vars */
const SBO_FREQ_DEFAULTS = {
  Weekly: { x: 308, y: 722 },
  Fortnightly: { x: 362, y: 722 },
  Monthly: { x: 418, y: 722 },
  Quarterly: { x: 482, y: 722 },
  Annually: { x: 548, y: 722 },
};

const SD19_FREQ_DEFAULTS = {
  Weekly: { x: 308, y: 548 },
  Fortnightly: { x: 362, y: 548 },
  Monthly: { x: 418, y: 548 },
  Quarterly: { x: 482, y: 548 },
  Annually: { x: 548, y: 548 },
};

function buildFrequencyTicks(prefix, defaults) {
  const tickSize = numEnv(`${prefix}_TICK_SIZE`, 11);
  const out = {};
  for (const [label, def] of Object.entries(defaults)) {
    const sfx = FREQ_ENV_SUFFIX[label];
    out[label] = {
      x: numEnv(`${prefix}_${sfx}_X`, def.x),
      y: numEnv(`${prefix}_${sfx}_Y`, def.y),
      size: tickSize,
    };
  }
  return out;
}

const assetDir = path.join(__dirname, "../assets/membership-forms");

function paths() {
  return {
    sbo:
      process.env.MEMBERSHIP_FORM_SBO_PDF || path.join(assetDir, "sbo-2492.pdf"),
    sd19:
      process.env.MEMBERSHIP_FORM_SD19_PDF || path.join(assetDir, "sd19.pdf"),
  };
}

function sboLayout() {
  const baseX = numEnv("FORM_SBO_INMO_REF_X", 320);
  const baseY = numEnv("FORM_SBO_INMO_REF_Y", 698);
  const size = numEnv("FORM_SBO_INMO_REF_SIZE", 9);
  const slotCount = Math.min(
    8,
    Math.max(1, Math.round(numEnv("FORM_SBO_INMO_REF_SLOT_COUNT", 3))),
  );
  const slotDx = numEnv("FORM_SBO_INMO_REF_SLOT_DX", 92);
  const memberRefSlots = [];
  for (let i = 0; i < slotCount; i += 1) {
    memberRefSlots.push({
      x: numEnv(`FORM_SBO_INMO_REF_${i + 1}_X`, baseX + i * slotDx),
      y: numEnv(`FORM_SBO_INMO_REF_${i + 1}_Y`, baseY),
      size,
    });
  }

  return {
    /** @deprecated use memberRefSlots */
    memberRef: memberRefSlots[0],
    memberRefSlots,
    frequencyTicks: buildFrequencyTicks("FORM_SBO_FREQ", SBO_FREQ_DEFAULTS),
    amount: {
      x: numEnv("FORM_SBO_AMOUNT_X", 430),
      y: numEnv("FORM_SBO_AMOUNT_Y", 668),
      size: numEnv("FORM_SBO_AMOUNT_SIZE", 9),
    },
  };
}

/**
 * SD19 fallback layout — used only if pdf.js cannot read underscore segments (rare).
 * Prefer automatic detection in sd19LayoutDetect.js.
 */
function sd19LayoutFallback() {
  const pageW = 595.32;
  const margin = 28;
  const defaultFullWidthRight = pageW - margin;

  return {
    name: {
      lineLeft: numEnv("FORM_SD19_NAME_LINE_LEFT", 118),
      lineRight: numEnv("FORM_SD19_NAME_LINE_RIGHT", defaultFullWidthRight),
      y: numEnv("FORM_SD19_NAME_LINE_Y", 704),
      size: numEnv("FORM_SD19_NAME_SIZE", 10),
    },
    employedAt: {
      lineLeft: numEnv("FORM_SD19_EMPLOYED_LINE_LEFT", 118),
      lineRight: numEnv("FORM_SD19_EMPLOYED_LINE_RIGHT", defaultFullWidthRight),
      y: numEnv("FORM_SD19_EMPLOYED_LINE_Y", 676),
      size: numEnv("FORM_SD19_EMPLOYED_SIZE", 10),
    },
    inmo: {
      lineLeft: numEnv("FORM_SD19_INMO_LINE_LEFT", 132),
      lineRight: numEnv("FORM_SD19_INMO_LINE_RIGHT", 420),
      y: numEnv("FORM_SD19_INMO_LINE_Y", 408),
      size: numEnv("FORM_SD19_INMO_SIZE", 10),
    },
    payroll: {
      lineLeft: numEnv("FORM_SD19_PAYROLL_LINE_LEFT", 132),
      lineRight: numEnv("FORM_SD19_PAYROLL_LINE_RIGHT", 420),
      y: numEnv("FORM_SD19_PAYROLL_LINE_Y", 376),
      size: numEnv("FORM_SD19_PAYROLL_SIZE", 10),
    },
    amount: {
      lineLeft: numEnv("FORM_SD19_AMOUNT_LINE_LEFT", 132),
      lineRight: numEnv("FORM_SD19_AMOUNT_LINE_RIGHT", 420),
      y: numEnv("FORM_SD19_AMOUNT_LINE_Y", 344),
      size: numEnv("FORM_SD19_AMOUNT_SIZE", 10),
    },
    frequencyTicks: buildFrequencyTicks("FORM_SD19_FREQ", SD19_FREQ_DEFAULTS),
  };
}

module.exports = {
  paths,
  sboLayout,
  sd19LayoutFallback,
};

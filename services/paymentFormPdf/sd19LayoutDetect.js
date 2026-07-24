/**
 * SD19 “Authorisation to Deduct…” — locate underscore fill-in segments using pdf.js
 * text positions (no env tuning required when the PDF has a text layer).
 */

/** Minimum underscores to treat as a form rule line (not footer dashes). */
const UNDERSCORE_LINE_RE = /_{25,}/;

function mapUnderscoreItemToRow(item) {
  const t = item.transform;
  const lineLeft = t[4];
  const lineRight = t[4] + (item.width ?? 0);
  const y = t[5];
  const h = item.height ?? 12;
  const size = Math.min(11, Math.max(9, Math.round(h)));
  return { lineLeft, lineRight, y, size };
}

/**
 * @param {Uint8Array} pdfBytes
 * @returns {Promise<{ name: object, employedAt: object, inmo: object, payroll: object }>}
 */
async function detectSd19FillLayoutFromBytes(pdfBytes) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const page = await pdf.getPage(1);
  const textContent = await page.getTextContent();

  const underscoreRows = textContent.items
    .filter((item) => UNDERSCORE_LINE_RE.test(item.str || ""))
    .sort((a, b) => b.transform[5] - a.transform[5]);

  if (underscoreRows.length < 4) {
    throw new Error(
      `sd19 layout detect: expected at least 4 underscore rows, got ${underscoreRows.length}`
    );
  }

  const [name, employedAt, inmo, payroll] = underscoreRows.slice(0, 4).map(mapUnderscoreItemToRow);

  return { name, employedAt, inmo, payroll };
}

module.exports = { detectSd19FillLayoutFromBytes };

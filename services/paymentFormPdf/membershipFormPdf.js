const fs = require("fs");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { paths, sboLayout, sd19LayoutFallback } = require("../config/membershipFormLayout.js");
const logger = require("../config/logger.js");
const {
  detectSd19FillLayoutFromBytes,
} = require("./sd19LayoutDetect.js");
const { computeInstallmentDisplay } = require("./membershipFormFinancials.js");

/**
 * Draw text horizontally centred on [lineLeft, lineRight] at baseline y.
 * Shrinks font slightly if the string would overflow the segment.
 */
function drawTextCenteredOnLine(page, font, rawText, row, color) {
  let text = String(rawText ?? "").trim();
  if (!text) return;

  const { lineLeft, lineRight, y, size: baseSize } = row;
  const maxWidth = Math.max(0, lineRight - lineLeft - 4);
  let size = baseSize;
  let width = font.widthOfTextAtSize(text, size);
  while (width > maxWidth && size > 6) {
    size -= 0.5;
    width = font.widthOfTextAtSize(text, size);
  }
  if (width > maxWidth && maxWidth > 0) {
    const ellipsis = "...";
    while (
      text.length > 1 &&
      font.widthOfTextAtSize(text + ellipsis, size) > maxWidth
    ) {
      text = text.slice(0, -1);
    }
    text += ellipsis;
    width = font.widthOfTextAtSize(text, size);
  }

  const mid = (lineLeft + lineRight) / 2;
  const x = mid - width / 2;
  page.drawText(text, {
    x,
    y,
    size,
    font,
    color,
  });
}

function splitUnderlineRowIntoSlots(row, count) {
  if (!row || count <= 1) return row ? [row] : [];
  const { lineLeft, lineRight, y, size } = row;
  const total = Math.max(0, lineRight - lineLeft);
  const gap = 4;
  const cell = (total - gap * (count - 1)) / count;
  const slots = [];
  for (let i = 0; i < count; i += 1) {
    const left = lineLeft + i * (cell + gap);
    slots.push({
      lineLeft: left,
      lineRight: left + cell,
      y,
      size,
    });
  }
  return slots;
}

function drawFrequencyTick(page, font, ticks, layoutFreqKey, color) {
  if (!ticks || !layoutFreqKey) return;
  const pos = ticks[layoutFreqKey];
  if (!pos || pos.x == null || pos.y == null) return;
  const size = pos.size || 11;
  page.drawText("X", {
    x: pos.x,
    y: pos.y,
    size,
    font,
    color,
  });
}

/**
 * @param {"SBO"|"SD19"} kind
 * @param {{
 *   memberId: string,
 *   payrollNo?: string|null,
 *   memberFullName?: string|null,
 *   workLocation?: string|null,
 *   subscriptionDetails?: object|null,
 * }} fields
 * @returns {Promise<Buffer>}
 */
async function buildPrefilledMembershipFormPdf(
  kind,
  { memberId, payrollNo, memberFullName, workLocation, subscriptionDetails },
) {
  const p = paths();
  const srcPath = kind === "SBO" ? p.sbo : p.sd19;
  const bytes = fs.readFileSync(srcPath);
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const black = rgb(0, 0, 0);

  const sub = subscriptionDetails && typeof subscriptionDetails === "object"
    ? subscriptionDetails
    : {};
  const { amountStr, layoutFreqKey } = computeInstallmentDisplay(sub);

  if (kind === "SBO") {
    const layout = sboLayout();
    const refSlots = layout.memberRefSlots?.length
      ? layout.memberRefSlots
      : [layout.memberRef];
    const idText = String(memberId ?? "").trim();
    for (const slot of refSlots) {
      if (!slot || !idText) continue;
      page.drawText(idText, {
        x: slot.x,
        y: slot.y,
        size: slot.size || 9,
        font,
        color: black,
      });
    }

    drawFrequencyTick(page, font, layout.frequencyTicks, layoutFreqKey, black);

    if (amountStr && layout.amount) {
      page.drawText(amountStr, {
        x: layout.amount.x,
        y: layout.amount.y,
        size: layout.amount.size || 9,
        font,
        color: black,
      });
    }
  } else {
    const F = sd19LayoutFallback();
    let L;
    try {
      L = await detectSd19FillLayoutFromBytes(new Uint8Array(bytes));
    } catch (err) {
      logger.warn(
        { err: err?.message },
        "sd19: layout detect failed, using env/fallback coordinates"
      );
      L = { ...F };
    }
    L = {
      ...F,
      ...L,
      amount: F.amount,
      frequencyTicks: F.frequencyTicks,
      inmo: L.inmo || F.inmo,
    };
    drawTextCenteredOnLine(page, font, memberFullName, L.name, black);
    drawTextCenteredOnLine(page, font, workLocation, L.employedAt, black);

    const rawSlots = Number(process.env.FORM_SD19_INMO_SLOT_COUNT || "3");
    const inmoSlotCount = Number.isFinite(rawSlots)
      ? Math.min(8, Math.max(1, Math.round(rawSlots)))
      : 3;
    const idText = String(memberId ?? "").trim();
    if (L.inmo && idText) {
      const inmoSlots = splitUnderlineRowIntoSlots(L.inmo, inmoSlotCount);
      for (const slot of inmoSlots) {
        drawTextCenteredOnLine(page, font, idText, slot, black);
      }
    }

    const payrollText =
      payrollNo != null && String(payrollNo).trim() !== ""
        ? String(payrollNo).trim()
        : "";
    if (payrollText) {
      drawTextCenteredOnLine(page, font, payrollText, L.payroll, black);
    }

    drawFrequencyTick(page, font, L.frequencyTicks, layoutFreqKey, black);

    if (amountStr && L.amount) {
      drawTextCenteredOnLine(page, font, amountStr, L.amount, black);
    }
  }

  const out = await doc.save();
  return Buffer.from(out);
}

module.exports = { buildPrefilledMembershipFormPdf };

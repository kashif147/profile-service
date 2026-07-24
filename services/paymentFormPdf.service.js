const path = require("path");
const fs = require("fs");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { AppError } = require("../errors/AppError.js");
const { decryptField } = require("../helpers/paymentFormCrypto.js");

function safeDecryptField(stored) {
  if (stored == null || stored === "") return null;
  try {
    return decryptField(stored);
  } catch {
    return null;
  }
}

const FILENAMES = {
  STANDING_ORDER: "INMO-Standing-Order-Form-SBO-2492.pdf",
  SALARY_DEDUCTION: "INMO-Salary-Deduction-Form-SD19.pdf",
  DD_MANDATE: "SEPA-Direct-Debit-Mandate.pdf",
};

function loadTemplatePdfBuilder() {
  // Own copy under services/paymentFormPdf/ — see payment-forms.md for why this is a copy
  // rather than a shared package (this used to reach across into notification-service's source
  // tree via a relative path, which only worked in a local monorepo checkout and threw in any
  // real container deployment since each service's Dockerfile only copies its own repo).
  const templatePath = path.join(__dirname, "paymentFormPdf/membershipFormPdf.js");
  try {
    if (fs.existsSync(templatePath)) {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      return require(templatePath).buildPrefilledMembershipFormPdf;
    }
  } catch {
    /* fall through to null */
  }
  return null;
}

const buildTemplatePdf = loadTemplatePdfBuilder();

function subscriptionDetailsForPdf(form) {
  const so = form.standingOrder || {};
  const sd = form.salaryDeduction || {};
  const sub = form.subscription || {};
  return {
    paymentFrequency:
      so.paymentFrequency || sub.paymentFrequency || "Monthly",
    membershipCategory: sub.membershipCategory,
    membershipFeeAnnualEur:
      so.annualMembershipFeeEur ??
      sub.annualMembershipFee ??
      sub.membershipFeeAnnualEur,
    membershipFee:
      so.installmentAmountEur ??
      sd.installmentAmountEur ??
      sub.membershipFee,
    paymentType: sub.paymentType,
    payrollNo: sd.payrollStaffNo || sub.payrollNo,
  };
}

async function buildTemplateFormPdf(form) {
  if (!buildTemplatePdf) {
    throw AppError.serviceUnavailable(
      "Payment form PDF templates are not configured on this server"
    );
  }
  const kind = form.formType === "STANDING_ORDER" ? "SBO" : "SD19";
  const sd = form.salaryDeduction || {};
  return buildTemplatePdf(kind, {
    memberId: String(form.membershipNumber || ""),
    payrollNo: sd.payrollStaffNo || form.subscription?.payrollNo || null,
    memberFullName: sd.memberFullName || "",
    workLocation: sd.employedAt || "",
    subscriptionDetails: subscriptionDetailsForPdf(form),
  });
}

function paymentTypeLabel(dd) {
  return dd.paymentTypeRecurrent === false ? "One-off payment" : "Recurrent payment";
}

async function buildDdMandatePdf(form) {
  const dd = form.directDebitMandate || {};
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.32, 841.89]);
  const black = rgb(0, 0, 0);
  const margin = 48;
  let y = 800;

  const drawLine = (text, opts = {}) => {
    const size = opts.size || 10;
    const useFont = opts.bold ? bold : font;
    const lines = String(text || "").split("\n");
    for (const line of lines) {
      if (y < margin) break;
      page.drawText(line, { x: margin, y, size, font: useFont, color: black });
      y -= size + 6;
    }
  };

  drawLine("SEPA Direct Debit Mandate", { size: 14, bold: true });
  y -= 8;
  drawLine(`Membership no.: ${form.membershipNumber || "—"}`, { bold: true });
  drawLine(`Unique mandate reference: ${dd.uniqueMandateReference || "—"}`);
  y -= 10;

  drawLine("Creditor", { size: 11, bold: true });
  drawLine(dd.creditorName || "—");
  drawLine(`Creditor identifier: ${dd.creditorIdentifier || "—"}`);
  drawLine(dd.creditorAddress || "—");
  drawLine(
    [dd.creditorCity, dd.creditorPostcode, dd.creditorCountry]
      .filter(Boolean)
      .join(", ")
  );
  y -= 10;

  drawLine("Debtor", { size: 11, bold: true });
  drawLine(dd.debtorName || "—");
  drawLine(dd.debtorAddress || "—");
  drawLine(
    [dd.debtorCity, dd.debtorPostcode, dd.debtorCountry].filter(Boolean).join(", ")
  );
  const debtorIban =
    safeDecryptField(dd.debtorIban) || dd.debtorIbanPlain || dd.debtorIbanDisplay || "";
  const debtorBic = safeDecryptField(dd.debtorBic) || dd.debtorBicPlain || "";
  drawLine(`IBAN: ${debtorIban || "—"}`);
  drawLine(`BIC: ${debtorBic || "—"}`);
  y -= 10;

  drawLine(`Type of payment: ${paymentTypeLabel(dd)}`);
  drawLine(`Authorised: ${dd.isAuthorized ? "Yes" : "No"}`);
  if (dd.signedDate) {
    drawLine(`Signed date: ${new Date(dd.signedDate).toLocaleDateString("en-IE")}`);
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

function pdfFilenameForForm(form) {
  const base = FILENAMES[form.formType] || "payment-form.pdf";
  if (form.formType === "DD_MANDATE" && form.membershipNumber) {
    return `SEPA-Direct-Debit-Mandate-${form.membershipNumber}.pdf`;
  }
  return base;
}

async function buildPaymentFormPdfBuffer(form) {
  if (!form?.formType) {
    throw AppError.badRequest("Payment form type is required");
  }
  if (form.formType === "DD_MANDATE") {
    return buildDdMandatePdf(form);
  }
  if (form.formType === "STANDING_ORDER" || form.formType === "SALARY_DEDUCTION") {
    return buildTemplateFormPdf(form);
  }
  throw AppError.badRequest(`Unsupported form type for PDF: ${form.formType}`);
}

module.exports = {
  buildPaymentFormPdfBuffer,
  pdfFilenameForForm,
};

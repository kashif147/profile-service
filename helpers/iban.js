function normalizeIban(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function mod97(iban) {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = "";
  for (let i = 0; i < rearranged.length; i += 1) {
    const ch = rearranged[i];
    remainder += /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    if (remainder.length > 9) {
      remainder = String(parseInt(remainder, 10) % 97);
    }
  }
  return parseInt(remainder, 10) % 97;
}

function validateIban(value) {
  const iban = normalizeIban(value);
  if (!iban) return { valid: false, message: "IBAN is required" };
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) {
    return { valid: false, message: "Invalid IBAN format" };
  }
  if (iban.length < 15 || iban.length > 34) {
    return { valid: false, message: "Invalid IBAN length" };
  }
  if (mod97(iban) !== 1) {
    return { valid: false, message: "IBAN check digits are invalid" };
  }
  return { valid: true, iban };
}

function maskIban(iban) {
  const n = normalizeIban(iban);
  if (n.length <= 8) return "****";
  return `${n.slice(0, 4)}****${n.slice(-4)}`;
}

function normalizeBic(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function validateBic(value) {
  const bic = normalizeBic(value);
  if (!bic) return { valid: true, bic: "" };
  if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) {
    return { valid: false, message: "Invalid BIC format" };
  }
  return { valid: true, bic };
}

function debtorMatchesOrganisationBank({
  debtorIban,
  debtorBic,
  organisationIban,
  organisationBic,
}) {
  const orgIban = normalizeIban(organisationIban);
  const orgBic = normalizeBic(organisationBic);
  const memberIban = normalizeIban(debtorIban);
  const memberBic = normalizeBic(debtorBic);

  if (orgIban && memberIban && memberIban === orgIban) {
    return {
      matches: true,
      message:
        "Debtor IBAN cannot be the same as the organisation creditor/beneficiary IBAN",
    };
  }
  if (orgBic && memberBic && memberBic === orgBic) {
    return {
      matches: true,
      message:
        "Debtor BIC cannot be the same as the organisation creditor/beneficiary BIC",
    };
  }
  return { matches: false };
}

module.exports = {
  normalizeIban,
  validateIban,
  maskIban,
  normalizeBic,
  validateBic,
  debtorMatchesOrganisationBank,
};

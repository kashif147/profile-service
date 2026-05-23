const mongoose = require("mongoose");
const axios = require("axios");
const Profile = require("../models/profile.model.js");
const {
  MemberPaymentForm,
  PAYMENT_FORM_TYPES,
  PAYMENT_FORM_STATUSES,
} = require("../models/memberPaymentForm.model.js");
const { AppError } = require("../errors/AppError.js");
const { fetchTenantContext, formatOrgAddress, formatBankAddress } = require("./tenant.service.client.js");
const {
  fetchCurrentSubscriptionByProfileId,
  SUBSCRIPTION_SERVICE_URL,
} = require("./subscription.service.client.js");
const { computeInstallmentDisplay } = require("../helpers/paymentFormFinancials.js");
const { resolveClientIp } = require("../helpers/clientIp.js");
const {
  validateIban,
  validateBic,
  maskIban,
  normalizeIban,
} = require("../helpers/iban.js");
const { encryptField, decryptField } = require("../helpers/paymentFormCrypto.js");
const azureBlob = require("./azure.blob.service.js");
const PaymentFormEventPublisher = require("../rabbitMQ/publishers/paymentForm.publisher.js");

const FORM_TYPE_LABELS = {
  STANDING_ORDER: "Standing Order",
  SALARY_DEDUCTION: "Salary Deduction",
  DD_MANDATE: "Direct Debit Mandate",
};

const PAYMENT_TYPE_BY_FORM = {
  STANDING_ORDER: "Standing Order",
  SALARY_DEDUCTION: "Salary Deduction",
  DD_MANDATE: "Direct Debit",
};

function resolveMemberFullName(profile) {
  const pi = profile?.personalInfo || {};
  if (pi.fullName) return String(pi.fullName).trim();
  return [pi.forename, pi.surname].filter(Boolean).join(" ").trim();
}

function resolveWorkLocation(profile) {
  const pd = profile?.professionalDetails || {};
  return (
    String(pd.workLocation || "").trim() ||
    String(pd.otherWorkLocation || "").trim() ||
    ""
  );
}

function resolveDebtorAddress(profile) {
  const ci = profile?.contactInfo || {};
  if (ci.fullAddress) return String(ci.fullAddress).trim();
  const parts = [
    ci.buildingOrHouse,
    ci.streetOrRoad,
    ci.areaOrTown,
    ci.countyCityOrPostCode,
    ci.eircode,
    ci.country,
  ].filter(Boolean);
  return parts.join(", ");
}

function buildSubscriptionPayload(subscription) {
  if (!subscription) return {};
  return {
    membershipCategory: subscription.membershipCategory,
    paymentFrequency: subscription.paymentFrequency,
    paymentType: subscription.paymentType,
    payrollNo: subscription.payrollNo,
  };
}

async function loadProfileForTenant(profileId, tenantId) {
  const profile = await Profile.findOne({
    _id: profileId,
    tenantId,
  }).lean();
  if (!profile) throw AppError.notFound("Profile not found");
  return profile;
}

function applyTenantBeneficiary(org, installment) {
  const bankAddr = org.bankAddress || {};
  const bankAddressFormatted = formatBankAddress(bankAddr);
  return {
    beneficiaryAccountName: org.legalName || org.tradingName || "",
    beneficiaryBankName: org.bankName || "",
    beneficiaryAddress: bankAddressFormatted,
    beneficiaryBic: org.bic || "",
    beneficiaryIban: org.iban || "",
    creditorName: org.legalName || org.tradingName || "",
    creditorIdentifier: org.sepaOriginatorIdentificationNumber || "",
    creditorAddress: bankAddressFormatted || formatOrgAddress(org),
    creditorCity: bankAddr.areaOrTown || "",
    creditorPostcode: bankAddr.eircode || bankAddr.countyCityOrPostCode || "",
    creditorCountry: bankAddr.country || "Ireland",
    ...installment,
  };
}

async function hydrateFormFields(profile, subscription, tenantCtx, formType) {
  const sub = buildSubscriptionPayload(subscription);
  const installment = computeInstallmentDisplay(sub);
  const org = tenantCtx.organisationProfile || {};
  const memberName = resolveMemberFullName(profile);
  const base = {
    membershipNumber: profile.membershipNumber,
    subscriptionId: subscription?._id?.toString?.() || null,
    userId: profile.userId?.toString?.() || null,
    brandingSnapshot: tenantCtx.branding || {},
    organisationSnapshot: org,
  };

  if (formType === "STANDING_ORDER") {
    const ben = applyTenantBeneficiary(org, {});
    return {
      ...base,
      standingOrder: {
        ...ben,
        beneficiaryReference: profile.membershipNumber,
        paymentFrequency: sub.paymentFrequency || "Monthly",
        frequencyLayoutKey: installment.layoutFreqKey,
        installmentAmountEur: installment.installmentAmountEur,
        installmentAmountDisplay: installment.amountStr,
      },
    };
  }

  if (formType === "SALARY_DEDUCTION") {
    return {
      ...base,
      salaryDeduction: {
        memberFullName: memberName,
        employedAt: resolveWorkLocation(profile),
        referenceMembershipNo: profile.membershipNumber,
        payrollStaffNo: sub.payrollNo || profile.professionalDetails?.payrollNo || "",
        installmentAmountEur: installment.installmentAmountEur,
        installmentAmountDisplay: installment.amountStr,
      },
    };
  }

  if (formType === "DD_MANDATE") {
    const ben = applyTenantBeneficiary(org, {});
    const addr = resolveDebtorAddress(profile);
    return {
      ...base,
      directDebitMandate: {
        creditorName: ben.creditorName,
        creditorIdentifier: ben.creditorIdentifier,
        creditorAddress: ben.creditorAddress,
        creditorCity: ben.creditorCity,
        creditorPostcode: ben.creditorPostcode,
        creditorCountry: ben.creditorCountry,
        uniqueMandateReference: profile.membershipNumber,
        paymentTypeRecurrent: true,
        debtorName: memberName,
        debtorAddress: addr,
        debtorCity: profile.contactInfo?.areaOrTown || "",
        debtorPostcode:
          profile.contactInfo?.eircode ||
          profile.contactInfo?.countyCityOrPostCode ||
          "",
        debtorCountry: profile.contactInfo?.country || "Ireland",
        isAuthorized: false,
      },
    };
  }

  throw AppError.badRequest("Invalid form type");
}

function decryptFormForResponse(doc, { includeSensitive = false } = {}) {
  const o = doc.toObject ? doc.toObject() : { ...doc };
  const maskField = (enc) => {
    const plain = decryptField(enc);
    return includeSensitive ? plain : maskIban(plain);
  };
  if (o.standingOrder?.debtorIban) {
    o.standingOrder.debtorIbanDisplay = maskField(o.standingOrder.debtorIban);
    if (!includeSensitive) delete o.standingOrder.debtorIban;
  }
  if (o.directDebitMandate?.debtorIban) {
    o.directDebitMandate.debtorIbanDisplay = maskField(
      o.directDebitMandate.debtorIban
    );
    if (!includeSensitive) delete o.directDebitMandate.debtorIban;
  }
  if (o.standingOrder?.debtorBic && !includeSensitive) {
    delete o.standingOrder.debtorBic;
  }
  if (o.directDebitMandate?.debtorBic && !includeSensitive) {
    delete o.directDebitMandate.debtorBic;
  }
  if (includeSensitive) {
    if (o.standingOrder?.debtorIban?.value) {
      o.standingOrder.debtorIbanPlain = decryptField(o.standingOrder.debtorIban);
    }
    if (o.standingOrder?.debtorBic?.value) {
      o.standingOrder.debtorBicPlain = decryptField(o.standingOrder.debtorBic);
    }
    if (o.directDebitMandate?.debtorIban?.value) {
      o.directDebitMandate.debtorIbanPlain = decryptField(
        o.directDebitMandate.debtorIban
      );
    }
    if (o.directDebitMandate?.debtorBic?.value) {
      o.directDebitMandate.debtorBicPlain = decryptField(
        o.directDebitMandate.debtorBic
      );
    }
  }
  return o;
}

function pushAudit(form, action, req, extra = {}) {
  const { clientIp } = resolveClientIp(req);
  form.auditTrail = form.auditTrail || [];
  form.auditTrail.push({
    at: new Date(),
    action,
    actorId: req.user?.id || req.userId || null,
    actorType: req.user?.userType === "PORTAL" ? "PORTAL" : "CRM",
    clientIp,
    channel: extra.channel || req.user?.userType || "crm",
  });
}

async function prefillForm({ tenantId, profileId, formType, req }) {
  if (!PAYMENT_FORM_TYPES.includes(formType)) {
    throw AppError.badRequest(`formType must be one of: ${PAYMENT_FORM_TYPES.join(", ")}`);
  }
  const profile = await loadProfileForTenant(profileId, tenantId);
  const subscription = await fetchCurrentSubscriptionByProfileId(
    profileId,
    tenantId,
    req,
    profile.currentSubscriptionId
  );
  const tenantCtx = await fetchTenantContext(tenantId, req);
  const hydrated = await hydrateFormFields(
    profile,
    subscription,
    tenantCtx,
    formType
  );
  return {
    formType,
    profileId: String(profile._id),
    membershipNumber: profile.membershipNumber,
    source: "crm",
    unsaved: true,
    formTypeLabel: FORM_TYPE_LABELS[formType] || formType,
    ...hydrated,
  };
}

function applyFormBodyUpdates(form, body) {
  if (body.standingOrder) {
    const so = body.standingOrder;
    if (so.debtorIban) {
      const v = validateIban(so.debtorIban);
      if (!v.valid) throw AppError.badRequest(v.message);
      form.standingOrder.debtorIban = encryptField(v.iban);
    }
    if (so.debtorBic) {
      const b = validateBic(so.debtorBic);
      if (!b.valid) throw AppError.badRequest(b.message);
      form.standingOrder.debtorBic = encryptField(b.bic);
    }
    Object.assign(form.standingOrder, {
      debtorBankName: so.debtorBankName ?? form.standingOrder.debtorBankName,
      debtorBankAddress:
        so.debtorBankAddress ?? form.standingOrder.debtorBankAddress,
      debtorAccountName:
        so.debtorAccountName ?? form.standingOrder.debtorAccountName,
      startDate: so.startDate ? new Date(so.startDate) : form.standingOrder.startDate,
      signatureDates:
        so.signatureDates?.length > 0
          ? so.signatureDates.map((d) => new Date(d))
          : form.standingOrder.signatureDates,
    });
  }

  if (body.salaryDeduction) {
    const sd = body.salaryDeduction;
    Object.assign(form.salaryDeduction, {
      commencingDate: sd.commencingDate
        ? new Date(sd.commencingDate)
        : form.salaryDeduction.commencingDate,
      signedDate: sd.signedDate
        ? new Date(sd.signedDate)
        : form.salaryDeduction.signedDate,
      payrollStaffNo: sd.payrollStaffNo ?? form.salaryDeduction.payrollStaffNo,
      employedAt: sd.employedAt ?? form.salaryDeduction.employedAt,
    });
  }

  if (body.directDebitMandate) {
    const dd = body.directDebitMandate;
    if (dd.debtorIban) {
      const v = validateIban(dd.debtorIban);
      if (!v.valid) throw AppError.badRequest(v.message);
      form.directDebitMandate.debtorIban = encryptField(v.iban);
    }
    if (dd.debtorBic) {
      const b = validateBic(dd.debtorBic);
      if (!b.valid) throw AppError.badRequest(b.message);
      form.directDebitMandate.debtorBic = encryptField(b.bic);
    }
    Object.assign(form.directDebitMandate, {
      debtorName: dd.debtorName ?? form.directDebitMandate.debtorName,
      debtorAddress: dd.debtorAddress ?? form.directDebitMandate.debtorAddress,
      debtorCity: dd.debtorCity ?? form.directDebitMandate.debtorCity,
      debtorPostcode: dd.debtorPostcode ?? form.directDebitMandate.debtorPostcode,
      debtorCountry: dd.debtorCountry ?? form.directDebitMandate.debtorCountry,
      signedDate: dd.signedDate
        ? new Date(dd.signedDate)
        : form.directDebitMandate.signedDate,
      isAuthorized:
        typeof dd.isAuthorized === "boolean"
          ? dd.isAuthorized
          : form.directDebitMandate.isAuthorized,
    });
  }

  if (body.emailOptions) {
    form.emailOptions = { ...form.emailOptions?.toObject?.(), ...body.emailOptions };
  }

  if (body.gdpr?.consentCapturedAt) {
    form.gdpr = form.gdpr || {};
    form.gdpr.consentCapturedAt = new Date(body.gdpr.consentCapturedAt);
  }
}

async function createForm({
  tenantId,
  profileId,
  formType,
  req,
  source = "crm",
  payload = {},
}) {
  if (!PAYMENT_FORM_TYPES.includes(formType)) {
    throw AppError.badRequest(`formType must be one of: ${PAYMENT_FORM_TYPES.join(", ")}`);
  }
  const profile = await loadProfileForTenant(profileId, tenantId);
  const subscription = await fetchCurrentSubscriptionByProfileId(
    profileId,
    tenantId,
    req,
    profile.currentSubscriptionId
  );
  const tenantCtx = await fetchTenantContext(tenantId, req);
  const hydrated = await hydrateFormFields(
    profile,
    subscription,
    tenantCtx,
    formType
  );

  const form = await MemberPaymentForm.create({
    tenantId,
    profileId: profile._id,
    membershipNumber: profile.membershipNumber,
    formType,
    status: "draft",
    source,
    ...hydrated,
    meta: { createdBy: req.user?.id || null },
    visibility: { portalVisible: false },
  });

  if (payload && Object.keys(payload).length > 0) {
    applyFormBodyUpdates(form, payload);
  }

  pushAudit(form, "created", req, { channel: source });
  await form.save();
  return getById(String(form._id), tenantId, { includeSensitive: true });
}

async function listWithFilter({ tenantId, filters = {}, page = 1, limit = 500 }) {
  const query = { tenantId };
  if (filters.formType) {
    const types = Array.isArray(filters.formType)
      ? filters.formType
      : [filters.formType];
    const mapped = types.map((t) => {
      const lower = String(t).toLowerCase();
      if (lower.includes("standing")) return "STANDING_ORDER";
      if (lower.includes("salary") || lower.includes("deduction")) {
        return "SALARY_DEDUCTION";
      }
      if (lower.includes("direct") || lower.includes("debit")) {
        return "DD_MANDATE";
      }
      return t;
    });
    query.formType = { $in: mapped };
  }
  if (filters.status) {
    query.status = filters.status;
  }
  if (filters.membershipNumber) {
    query.membershipNumber = new RegExp(
      String(filters.membershipNumber).trim(),
      "i"
    );
  }

  const skip = (Math.max(1, page) - 1) * limit;
  const [items, total] = await Promise.all([
    MemberPaymentForm.find(query).sort({ updatedAt: -1 }).skip(skip).limit(limit),
    MemberPaymentForm.countDocuments(query),
  ]);

  return {
    paymentForms: items.map((d) => formatListRow(d)),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

function formatListRow(doc) {
  const o = decryptFormForResponse(doc, { includeSensitive: false });
  const pi = {
    formType: o.formType,
    formTypeLabel: FORM_TYPE_LABELS[o.formType] || o.formType,
    status: o.status,
    membershipNumber: o.membershipNumber,
    profileId: o.profileId,
    _id: o._id,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    source: o.source,
    memberFullName:
      o.salaryDeduction?.memberFullName ||
      o.directDebitMandate?.debtorName ||
      o.standingOrder?.debtorAccountName ||
      "",
    referenceMembershipNo:
      o.salaryDeduction?.referenceMembershipNo ||
      o.directDebitMandate?.uniqueMandateReference ||
      o.standingOrder?.beneficiaryReference ||
      o.membershipNumber,
    isAuthorized: o.directDebitMandate?.isAuthorized || false,
  };
  return pi;
}

async function getById(id, tenantId, { includeSensitive = false, portalUserId = null }) {
  const form = await MemberPaymentForm.findOne({ _id: id, tenantId });
  if (!form) throw AppError.notFound("Payment form not found");
  if (portalUserId && form.userId && String(form.userId) !== String(portalUserId)) {
    throw AppError.forbidden("Access denied");
  }
  if (portalUserId && !form.visibility?.portalVisible && form.status !== "draft") {
    const allowed = ["submitted", "verified", "active"].includes(form.status);
    if (!allowed) throw AppError.forbidden("Form not available on portal");
  }
  const out = decryptFormForResponse(form, { includeSensitive });
  out.downloadUrls = buildDownloadUrls(form);
  return out;
}

function buildDownloadUrls(form) {
  const urls = {};
  if (form.generatedPdf?.blobPath) {
    urls.generatedPdf = azureBlob.getDownloadSasUrl(form.generatedPdf.blobPath);
  }
  if (form.signedPdf?.blobPath) {
    urls.signedPdf = azureBlob.getDownloadSasUrl(form.signedPdf.blobPath);
  }
  if (form.paperUpload?.blobPath) {
    urls.paperUpload = azureBlob.getDownloadSasUrl(form.paperUpload.blobPath);
  }
  return urls;
}

async function updateForm(id, tenantId, body, req, { portal = false } = {}) {
  const form = await MemberPaymentForm.findOne({ _id: id, tenantId });
  if (!form) throw AppError.notFound("Payment form not found");

  if (portal && form.userId && String(form.userId) !== String(req.userId)) {
    throw AppError.forbidden("Access denied");
  }

  applyFormBodyUpdates(form, body);

  form.meta = form.meta || {};
  form.meta.updatedBy = req.user?.id || req.userId || null;
  pushAudit(form, "updated", req);
  await form.save();
  return getById(id, tenantId, { includeSensitive: !portal });
}

async function submitForm(id, tenantId, req, { portal = false } = {}) {
  const form = await MemberPaymentForm.findOne({ _id: id, tenantId });
  if (!form) throw AppError.notFound("Payment form not found");
  if (portal && form.userId && String(form.userId) !== String(req.userId)) {
    throw AppError.forbidden("Access denied");
  }

  const { clientIp, ipSource } = resolveClientIp(req);
  form.status = "submitted";
  form.submissionAudit = {
    submittedAt: new Date(),
    submittedByUserId: req.user?.id || req.userId,
    submittedByUserType: portal ? "PORTAL" : "CRM",
    clientIp,
    ipSource,
    userAgent: String(req.headers["user-agent"] || "").slice(0, 500),
    channel: portal ? "portal" : "crm",
  };
  if (!form.gdpr?.consentCapturedAt) {
    form.gdpr = form.gdpr || {};
    form.gdpr.consentCapturedAt = new Date();
  }
  pushAudit(form, "submitted", req, {
    channel: portal ? "portal" : "crm",
  });
  await form.save();
  return getById(id, tenantId, { includeSensitive: !portal });
}

async function verifyForm(id, tenantId, req) {
  const form = await MemberPaymentForm.findOne({ _id: id, tenantId });
  if (!form) throw AppError.notFound("Payment form not found");
  form.status = "verified";
  pushAudit(form, "verified", req);
  await form.save();
  return getById(id, tenantId, { includeSensitive: true });
}

async function syncSubscriptionPaymentType(form, req) {
  const subId = form.subscriptionId;
  if (!subId) return;
  const paymentType = PAYMENT_TYPE_BY_FORM[form.formType];
  if (!paymentType) return;
  const base = SUBSCRIPTION_SERVICE_URL.replace(/\/$/, "");
  const body = { paymentType };
  if (form.formType === "SALARY_DEDUCTION") {
    body.payrollNo =
      form.salaryDeduction?.payrollStaffNo ||
      form.salaryDeduction?.payrollNo ||
      null;
  }
  const headers = {
    "Content-Type": "application/json",
    "x-internal-request": "true",
    "x-tenant-id": form.tenantId,
  };
  if (req?.headers?.authorization) {
    headers.authorization = req.headers.authorization;
  }
  try {
    await axios.put(`${base}/api/v1/subscriptions/${subId}`, body, {
      headers,
      timeout: 10000,
    });
  } catch (err) {
    console.warn("[paymentForm] subscription update failed:", err.message);
  }
}

async function approveForm(id, tenantId, req) {
  const form = await MemberPaymentForm.findOne({ _id: id, tenantId });
  if (!form) throw AppError.notFound("Payment form not found");
  if (!["submitted", "verified", "generated"].includes(form.status)) {
    throw AppError.badRequest(
      `Cannot approve form in status ${form.status}`
    );
  }

  const { clientIp } = resolveClientIp(req);
  form.status = "active";
  form.approvalAudit = {
    approvedAt: new Date(),
    approvedByUserId: req.user?.id || req.userId,
    clientIp,
  };
  form.visibility = {
    portalVisible: true,
    portalVisibleFrom: new Date(),
  };
  const retentionYears = Number(process.env.PAYMENT_FORM_RETENTION_YEARS || 6);
  form.gdpr = form.gdpr || {};
  form.gdpr.retentionUntil = new Date();
  form.gdpr.retentionUntil.setFullYear(
    form.gdpr.retentionUntil.getFullYear() + retentionYears
  );

  pushAudit(form, "approved", req);
  await form.save();

  await syncSubscriptionPaymentType(form, req);

  const profile = await Profile.findById(form.profileId).lean();
  await PaymentFormEventPublisher.publishPaymentFormApproved({
    tenantId,
    userId: form.userId || profile?.userId?.toString?.(),
    profileId: String(form.profileId),
    paymentFormId: String(form._id),
    formType: form.formType,
    membershipNumber: form.membershipNumber,
    correlationId: require("crypto").randomUUID(),
  });

  const emailed = await queueMemberNotificationEmail(form, profile, req, {
    trigger: "approval",
  });
  if (emailed) {
    pushAudit(form, "email_queued", req, { automatic: true });
    await form.save();
  }

  return getById(id, tenantId, { includeSensitive: true });
}

async function rejectForm(id, tenantId, req, reason) {
  const form = await MemberPaymentForm.findOne({ _id: id, tenantId });
  if (!form) throw AppError.notFound("Payment form not found");
  form.status = "rejected";
  pushAudit(form, "rejected", req, { reason });
  await form.save();
  return getById(id, tenantId, { includeSensitive: true });
}

async function uploadPaper(id, tenantId, file, req) {
  const form = await MemberPaymentForm.findOne({ _id: id, tenantId });
  if (!form) throw AppError.notFound("Payment form not found");
  if (!file?.buffer) throw AppError.badRequest("File is required");

  const blobPath = azureBlob.buildPaymentFormBlobPath(
    tenantId,
    form.profileId,
    file.originalname || "paper.pdf"
  );
  const url = await azureBlob.uploadToBlob(
    blobPath,
    file.buffer,
    file.mimetype,
    file.originalname
  );
  form.paperUpload = {
    blobPath,
    fileName: file.originalname,
    contentType: file.mimetype,
    uploadedAt: new Date(),
    uploadedBy: req.user?.id || req.userId,
  };
  form.source = form.source === "crm" ? "post" : form.source;
  if (form.status === "draft" || form.status === "generated") {
    form.status = "submitted";
  }
  pushAudit(form, "paper_uploaded", req);
  await form.save();
  return { ...getById(id, tenantId, { includeSensitive: true }), uploadUrl: url };
}

async function uploadSignedPdf(id, tenantId, file, req) {
  const form = await MemberPaymentForm.findOne({ _id: id, tenantId });
  if (!form) throw AppError.notFound("Payment form not found");
  const blobPath = azureBlob.buildPaymentFormBlobPath(
    tenantId,
    form.profileId,
    file.originalname || "signed.pdf"
  );
  await azureBlob.uploadToBlob(
    blobPath,
    file.buffer,
    file.mimetype || "application/pdf",
    file.originalname
  );
  form.signedPdf = {
    blobPath,
    fileName: file.originalname,
    contentType: file.mimetype || "application/pdf",
  };
  pushAudit(form, "signed_pdf_uploaded", req);
  await form.save();
  return getById(id, tenantId, { includeSensitive: true });
}

const APPROVAL_EMAIL_BODY =
  "Your payment form has been approved. You can view it in the member portal.";

async function queueMemberNotificationEmail(
  form,
  profile,
  req,
  { sendTo: overrideTo, subject, body, attachPdf = true, trigger = "manual" } = {}
) {
  const sendTo =
    overrideTo ||
    profile?.contactInfo?.personalEmail ||
    profile?.contactInfo?.workEmail;
  if (!sendTo) return false;

  const resolvedSubject =
    subject ||
    `${FORM_TYPE_LABELS[form.formType]} – ${form.membershipNumber}`;
  const resolvedBody =
    body ||
    (trigger === "approval" ? APPROVAL_EMAIL_BODY : "Please find your payment form attached.");

  form.emailOptions = {
    sendTo,
    subject: resolvedSubject,
    body: resolvedBody,
    attachPdf: attachPdf !== false,
    sentAt: new Date(),
    sentBy: req.user?.id || req.userId,
    trigger,
  };

  await PaymentFormEventPublisher.publishMemberNotificationRequested({
    tenantId: form.tenantId,
    userId: form.userId || profile?.userId?.toString?.(),
    profileId: String(form.profileId),
    title: resolvedSubject,
    body: resolvedBody,
    metadata: {
      type: "PAYMENT_FORM_EMAIL",
      paymentFormId: String(form._id),
      formType: form.formType,
      memberId: form.membershipNumber,
      sendTo,
      trigger,
    },
    correlationId: require("crypto").randomUUID(),
  });

  return true;
}

async function sendFormEmail(id, tenantId, emailBody, req) {
  const form = await MemberPaymentForm.findOne({ _id: id, tenantId });
  if (!form) throw AppError.notFound("Payment form not found");

  const profile = await Profile.findById(form.profileId).lean();
  const queued = await queueMemberNotificationEmail(form, profile, req, {
    sendTo: emailBody.sendTo,
    subject: emailBody.subject,
    body: emailBody.body,
    attachPdf: emailBody.attachPdf,
    trigger: "manual",
  });
  if (!queued) throw AppError.badRequest("Recipient email is required");

  pushAudit(form, "email_queued", req);
  await form.save();
  return getById(id, tenantId, { includeSensitive: true });
}

async function listForProfile(profileId, tenantId, { portalUserId = null } = {}) {
  const profile = await loadProfileForTenant(profileId, tenantId);
  const query = { tenantId, profileId: profile._id };
  if (portalUserId) {
    query.$or = [
      { visibility: { portalVisible: true } },
      { status: { $in: ["submitted", "active"] } },
    ];
  }
  const items = await MemberPaymentForm.find(query).sort({ updatedAt: -1 });
  return items.map((d) => {
    const row = formatListRow(d);
    row.downloadUrls = buildDownloadUrls(d);
    row.formTypeLabel = FORM_TYPE_LABELS[d.formType] || d.formType;
    return row;
  });
}

async function listPortalForUser(tenantId, userId, req) {
  const profile = await Profile.findOne({ tenantId, userId }).lean();
  if (!profile) return [];
  return listForProfile(profile._id, tenantId, { portalUserId: userId });
}

module.exports = {
  prefillForm,
  createForm,
  listWithFilter,
  getById,
  updateForm,
  submitForm,
  verifyForm,
  approveForm,
  rejectForm,
  uploadPaper,
  uploadSignedPdf,
  sendFormEmail,
  listForProfile,
  listPortalForUser,
  PAYMENT_FORM_TYPES,
  FORM_TYPE_LABELS,
};

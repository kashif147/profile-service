const express = require("express");
const router = express.Router();
const controller = require("../controllers/paymentForm.controller.js");
const { upload } = require("../middlewares/upload.mw.js");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");
const {
  requireCrm,
  requirePortalUser,
  crmOrOwnProfile,
} = require("../middlewares/memberAccess");
const { requireBankDataRead } = require("../helpers/bankDataAccess.js");

// P5 portal object authorization. Member payment forms carry bank details: the CRM routes below are
// CRM staff only (payments permission); a portal member uses the /portal router, which acts only
// on forms of the caller's own profile (services/paymentForm.service.js assertPortalOwnsForm) and
// never returns plaintext IBAN/BIC.
const portalRead = defaultPolicyMiddleware.requirePermission("portal", "read");
const portalWrite = defaultPolicyMiddleware.requirePermission("portal", "write");
const crmRead = requireCrm("payments", "read");
// P5 prerequisite (blocker 1): CRM payment-form writes also need a finance action role (or ASU "*"); the portal
// router below is unchanged. See middlewares/p5ActionGuards.js.
const { requireFinanceActionRole } = require("../middlewares/p5ActionGuards");
const crmWrite = [...requireCrm("payments", "write"), requireFinanceActionRole];

router.put("/filter", crmRead, controller.filterPaymentForms);
// PDP P3 (Q2): the SEPA prepare feed is plaintext debtor bank data -> payments.bank:read on top of the
// CRM payments read, and a non-empty profileIds list (service). The direct-debit-prepare purpose of
// PUT /filter is gated the same way in the controller.
router.post(
  "/direct-debit/mandates-for-prepare",
  crmRead,
  requireBankDataRead,
  controller.listDirectDebitMandatesForPrepare,
);
// The portal application / payment pages prefill for the caller's own profile only.
router.get(
  "/prefill",
  crmOrOwnProfile("payments", "read", (req) => req.query && req.query.profileId),
  controller.prefillPaymentForm,
);
router.post("/", crmWrite, controller.createPaymentForm);
router.get("/profile/:profileId", crmRead, controller.listProfilePaymentForms);

const portalRouter = express.Router();
portalRouter.use(requirePortalUser);
portalRouter.get("/mine", portalRead, controller.portalListMine);
portalRouter.get("/prefill", portalRead, controller.portalPrefill);
portalRouter.post("/", portalWrite, controller.portalCreate);
portalRouter.get("/:id", portalRead, controller.portalGetById);
portalRouter.patch("/:id", portalWrite, controller.portalUpdate);
portalRouter.post("/:id/submit", portalWrite, controller.portalSubmit);
portalRouter.post(
  "/:id/upload-signed",
  portalWrite,
  upload.single("file"),
  controller.portalUploadSignedPdf
);
portalRouter.post(
  "/:id/upload-signature",
  portalWrite,
  upload.single("file"),
  controller.portalUploadSignature
);

router.use("/portal", portalRouter);

router.get("/:id/pdf", crmRead, controller.downloadPaymentFormPdf);
router.get("/:id", crmRead, controller.getPaymentFormById);
router.patch("/:id", crmWrite, controller.updatePaymentForm);
router.post("/:id/submit", crmWrite, controller.submitPaymentForm);
router.post("/:id/verify", crmWrite, controller.verifyPaymentForm);
router.post("/:id/approve", crmWrite, controller.approvePaymentForm);
router.post("/:id/reject", crmWrite, controller.rejectPaymentForm);
router.delete("/:id", crmWrite, controller.deletePaymentForm);
router.post(
  "/:id/upload-paper",
  crmWrite,
  upload.single("file"),
  controller.uploadPaper
);
router.post(
  "/:id/upload-signed",
  crmWrite,
  upload.single("file"),
  controller.uploadSignedPdf
);
router.post(
  "/:id/upload-signature",
  crmWrite,
  upload.single("file"),
  controller.uploadSignature
);
router.post("/:id/send-email", crmWrite, controller.sendEmail);

module.exports = router;

const express = require("express");
const router = express.Router();
const controller = require("../controllers/paymentForm.controller.js");
const { upload } = require("../middlewares/upload.mw.js");
const { defaultPolicyMiddleware } = require("../middlewares/policy.middleware");

const portalRead = defaultPolicyMiddleware.requirePermission("portal", "read");
const portalWrite = defaultPolicyMiddleware.requirePermission("portal", "write");

router.put("/filter", portalRead, controller.filterPaymentForms);
router.post(
  "/direct-debit/mandates-for-prepare",
  portalRead,
  controller.listDirectDebitMandatesForPrepare,
);
router.get("/prefill", portalRead, controller.prefillPaymentForm);
router.post("/", portalWrite, controller.createPaymentForm);
router.get("/profile/:profileId", portalRead, controller.listProfilePaymentForms);

const portalRouter = express.Router();
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

router.get("/:id/pdf", portalRead, controller.downloadPaymentFormPdf);
router.get("/:id", portalRead, controller.getPaymentFormById);
router.patch("/:id", portalWrite, controller.updatePaymentForm);
router.post("/:id/submit", portalWrite, controller.submitPaymentForm);
router.post("/:id/verify", portalWrite, controller.verifyPaymentForm);
router.post("/:id/approve", portalWrite, controller.approvePaymentForm);
router.post("/:id/reject", portalWrite, controller.rejectPaymentForm);
router.delete("/:id", portalWrite, controller.deletePaymentForm);
router.post(
  "/:id/upload-paper",
  portalWrite,
  upload.single("file"),
  controller.uploadPaper
);
router.post(
  "/:id/upload-signed",
  portalWrite,
  upload.single("file"),
  controller.uploadSignedPdf
);
router.post(
  "/:id/upload-signature",
  portalWrite,
  upload.single("file"),
  controller.uploadSignature
);
router.post("/:id/send-email", portalWrite, controller.sendEmail);

module.exports = router;

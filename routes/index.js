const express = require("express");
const router = express.Router();

router.use("/personal-details", require("./personal.details.routes"));
router.use("/professional-details", require("./professional.details.routes"));
router.use("/subscription-details", require("./subscription.details.routes"));
router.use("/applications", require("./application.routes"));
router.use("/applications", require("./applications.routes"));
router.use("/transfer-request", require("./transfer.request.routes"));
router.use("/corn-market", require("./corn.market.routes"));
router.use("/recruit-list", require("./recruit.a.friend.routes"));

module.exports = router;

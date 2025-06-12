const express = require("express");
const router = express.Router();

router.use("/auth", require("./auth.routes"));
router.use("/lookup", require("./lookup"));
router.use("/lookuptype", require("./lookuptype"));
module.exports = router;

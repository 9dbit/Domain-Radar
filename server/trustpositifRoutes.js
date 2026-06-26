const express = require("express");
const aiRoutes = require("./aiRoutes");

const router = express.Router();

router.use("/ai", aiRoutes);

module.exports = router;

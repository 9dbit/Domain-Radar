const express = require("express");
const { getRuntimeSettings, updateRuntimeSettings } = require("./runtimeSettings");

const router = express.Router();

router.get("/", (req, res) => {
  res.json(getRuntimeSettings());
});

router.post("/", (req, res) => {
  res.json(updateRuntimeSettings(req.body || {}));
});

module.exports = router;

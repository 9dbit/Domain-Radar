const express = require("express");
const { getRuntimeSettings, saveSettings } = require("./settingsStore");

const router = express.Router();

router.get("/", (req, res) => {
  res.json(getRuntimeSettings());
});

router.post("/", async (req, res, next) => {
  try {
    const saved = await saveSettings(req.body || {});
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

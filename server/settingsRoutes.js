const express = require("express");
const { getRuntimeSettings, saveSettings } = require("./settingsStore");

const router = express.Router();

function userId(req) {
  return req.user?.userId || req.session?.userId || null;
}

router.get("/", async (req, res, next) => {
  try {
    res.json(await getRuntimeSettings(userId(req)));
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    if (req.user?.role === "demo") return res.status(403).json({ error: "Demo account is read-only" });
    const saved = await saveSettings(req.body || {}, userId(req));
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

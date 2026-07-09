const defaults = {
  check_interval_seconds: process.env.CHECK_INTERVAL_SECONDS || "60",
  retry_confirmations: process.env.RETRY_CONFIRMATIONS || "3",
  status_keywords: process.env.STATUS_KEYWORDS || "internetpositif,trustpositif,nawala",
  telegram_bot_token: process.env.TELEGRAM_BOT_TOKEN || "",
  telegram_chat_id: process.env.TELEGRAM_CHAT_ID || ""
};

const state = { ...defaults };

function normalizeSettings(input = {}, base = defaults) {
  const next = { ...base };

  if (input.check_interval_seconds !== undefined) {
    const value = Number(input.check_interval_seconds);
    if (Number.isFinite(value) && value >= 60) next.check_interval_seconds = String(value);
  }

  if (input.retry_confirmations !== undefined) {
    const value = Number(input.retry_confirmations);
    if (Number.isFinite(value) && value >= 1) next.retry_confirmations = String(value);
  }

  if (input.status_keywords !== undefined) {
    next.status_keywords = String(input.status_keywords || "").trim();
  }

  if (input.telegram_bot_token !== undefined) {
    next.telegram_bot_token = String(input.telegram_bot_token || "").trim();
  }

  if (input.telegram_chat_id !== undefined) {
    next.telegram_chat_id = String(input.telegram_chat_id || "").trim();
  }

  return next;
}

function getRuntimeSettings() {
  return { ...state };
}

function updateRuntimeSettings(input = {}) {
  Object.assign(state, normalizeSettings(input, state));
  return getRuntimeSettings();
}

module.exports = { defaults, getRuntimeSettings, updateRuntimeSettings, normalizeSettings };

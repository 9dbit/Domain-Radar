const state = {
  check_interval_seconds: process.env.CHECK_INTERVAL_SECONDS || "60",
  retry_confirmations: process.env.RETRY_CONFIRMATIONS || "3",
  status_keywords: process.env.STATUS_KEYWORDS || "internetpositif,trustpositif,nawala"
};

function getRuntimeSettings() {
  return { ...state };
}

function updateRuntimeSettings(input = {}) {
  if (input.check_interval_seconds !== undefined) {
    const value = Number(input.check_interval_seconds);
    if (Number.isFinite(value) && value >= 60) {
      state.check_interval_seconds = String(value);
    }
  }

  if (input.retry_confirmations !== undefined) {
    const value = Number(input.retry_confirmations);
    if (Number.isFinite(value) && value >= 1) {
      state.retry_confirmations = String(value);
    }
  }

  if (input.status_keywords !== undefined) {
    state.status_keywords = String(input.status_keywords || "").trim();
  }

  return getRuntimeSettings();
}

module.exports = { getRuntimeSettings, updateRuntimeSettings };

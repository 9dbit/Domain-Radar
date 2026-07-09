const { pool } = require("./db");
const { defaults, getRuntimeSettings: getGlobalRuntimeSettings, updateRuntimeSettings, normalizeSettings } = require("./runtimeSettings");

const GLOBAL_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW()
  )
`;

const MERCHANT_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS merchant_settings (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, key)
  )
`;

async function ensureSettingsTable() {
  await pool.query(GLOBAL_TABLE_SQL);
  await pool.query(MERCHANT_TABLE_SQL);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_merchant_settings_user_id ON merchant_settings(user_id)");
}

async function loadSettings() {
  await ensureSettingsTable();
  const { rows } = await pool.query("SELECT key, value FROM app_settings");
  const values = {};
  for (const row of rows) values[row.key] = row.value;
  return updateRuntimeSettings(values);
}

async function getRuntimeSettings(userId = null) {
  await ensureSettingsTable();
  if (!userId) return getGlobalRuntimeSettings();
  const base = getGlobalRuntimeSettings();
  const { rows } = await pool.query("SELECT key, value FROM merchant_settings WHERE user_id=$1", [userId]);
  const values = {};
  for (const row of rows) values[row.key] = row.value;
  return normalizeSettings(values, { ...defaults, ...base });
}

async function saveSettings(input = {}, userId = null) {
  await ensureSettingsTable();
  if (!userId) {
    const saved = updateRuntimeSettings(input);
    for (const [key, value] of Object.entries(saved)) {
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
        [key, String(value)]
      );
    }
    return saved;
  }

  const current = await getRuntimeSettings(userId);
  const saved = normalizeSettings(input, current);
  for (const [key, value] of Object.entries(saved)) {
    await pool.query(
      `INSERT INTO merchant_settings (user_id, key, value, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
      [userId, key, String(value)]
    );
  }
  return saved;
}

module.exports = { ensureSettingsTable, loadSettings, saveSettings, getRuntimeSettings };

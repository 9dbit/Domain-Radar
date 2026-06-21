const { pool } = require("./db");
const { getRuntimeSettings, updateRuntimeSettings } = require("./runtimeSettings");

const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW()
  )
`;

async function ensureSettingsTable() {
  await pool.query(TABLE_SQL);
}

async function loadSettings() {
  await ensureSettingsTable();
  const { rows } = await pool.query("SELECT key, value FROM app_settings");
  const values = {};
  for (const row of rows) values[row.key] = row.value;
  return updateRuntimeSettings(values);
}

async function saveSettings(input = {}) {
  await ensureSettingsTable();
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

module.exports = { ensureSettingsTable, loadSettings, saveSettings, getRuntimeSettings };

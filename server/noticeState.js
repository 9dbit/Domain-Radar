const { pool } = require("./db");

let tableReady = false;

async function ensureNoticeTable() {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS telegram_notices (
      domain_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'blocked',
      noticed_at TIMESTAMP NOT NULL DEFAULT NOW(),
      telegram_user_id TEXT,
      telegram_username TEXT
    )
  `);
  tableReady = true;
}

async function isAcknowledged(domainId) {
  await ensureNoticeTable();
  const { rows } = await pool.query(
    "SELECT domain_id FROM telegram_notices WHERE domain_id=$1 AND status='blocked' LIMIT 1",
    [domainId]
  );
  return Boolean(rows[0]);
}

async function markAcknowledged(domainId, user = {}) {
  await ensureNoticeTable();
  await pool.query(
    `INSERT INTO telegram_notices (domain_id, status, noticed_at, telegram_user_id, telegram_username)
     VALUES ($1, 'blocked', NOW(), $2, $3)
     ON CONFLICT (domain_id) DO UPDATE SET
       status='blocked',
       noticed_at=NOW(),
       telegram_user_id=EXCLUDED.telegram_user_id,
       telegram_username=EXCLUDED.telegram_username`,
    [domainId, user.id ? String(user.id) : null, user.username || user.first_name || null]
  );
}

async function clearAcknowledged(domainId) {
  await ensureNoticeTable();
  await pool.query("DELETE FROM telegram_notices WHERE domain_id=$1", [domainId]);
}

module.exports = {
  ensureNoticeTable,
  isAcknowledged,
  markAcknowledged,
  clearAcknowledged
};

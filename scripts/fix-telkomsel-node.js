require('dotenv').config();
const { pool } = require('../server/db');

async function main() {
  const name = process.env.FIX_NODE_NAME || 'TELKOMSEL-JKT-01';
  const secret = process.env.FIX_NODE_SECRET || 'telkomsel-secret-001';
  const endpoint = process.env.FIX_NODE_ENDPOINT || '';

  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_nodes (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      provider_name TEXT,
      network_type TEXT,
      endpoint_url TEXT,
      secret_key TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      last_health_status TEXT DEFAULT 'waiting',
      last_ping_at TIMESTAMP,
      battery_percent INTEGER,
      charging_status TEXT,
      signal_strength INTEGER,
      signal_bars INTEGER,
      network_label TEXT,
      radio_type TEXT,
      raw_network_type TEXT,
      updated_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `).catch(() => null);

  await pool.query(`
    INSERT INTO provider_nodes (name, provider_name, network_type, endpoint_url, secret_key, is_active, last_health_status, updated_at)
    VALUES ($1, 'Telkomsel', 'mobile', $2, $3, TRUE, 'waiting', NOW())
    ON CONFLICT (name) DO UPDATE SET
      provider_name='Telkomsel',
      network_type='mobile',
      endpoint_url=COALESCE(NULLIF($2,''), provider_nodes.endpoint_url),
      secret_key=$3,
      is_active=TRUE,
      updated_at=NOW()
  `, [name, endpoint, secret]);

  const { rows } = await pool.query(`
    SELECT id, name, provider_name, network_type, endpoint_url, secret_key, is_active, last_health_status, last_ping_at
    FROM provider_nodes
    WHERE name=$1
  `, [name]);

  console.log(JSON.stringify({ ok: true, node: rows[0] }, null, 2));
  await pool.end();
}

main().catch(async (err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});

const express = require("express");
const axios = require("axios");
const { pool } = require("./db");

const router = express.Router();

function currentUser(req) {
  return req.user || { userId: req.session?.userId, role: req.session?.role };
}

function isSuperadmin(req) {
  return currentUser(req)?.role === "superadmin";
}

function nodeAccessWhere(req, alias = "") {
  if (isSuperadmin(req)) return { sql: "TRUE", params: [] };
  return { sql: `(${alias}user_id=$1 OR ${alias}is_platform_node=true)`, params: [currentUser(req).userId] };
}

function nodeWriteWhere(req, alias = "") {
  if (isSuperadmin(req)) return { sql: "TRUE", params: [] };
  return { sql: `${alias}user_id=$1 AND COALESCE(${alias}is_platform_node,false)=false`, params: [currentUser(req).userId] };
}

async function ensureNodeTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_nodes (
      id SERIAL PRIMARY KEY,
      user_id UUID REFERENCES users(id),
      name TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      network_type TEXT DEFAULT 'broadband',
      endpoint_url TEXT NOT NULL,
      secret_key TEXT DEFAULT '',
      is_platform_node BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT TRUE,
      last_health_status TEXT DEFAULT 'unknown',
      last_ping_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query("ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)");
  await pool.query("ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS is_platform_node BOOLEAN DEFAULT false");
  await pool.query("ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS last_health_reason TEXT");
  await pool.query("ALTER TABLE provider_nodes DROP CONSTRAINT IF EXISTS provider_nodes_name_key");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_nodes_user_name ON provider_nodes(user_id, name)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_provider_nodes_user_id ON provider_nodes(user_id)");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS node_telemetry (
      node_id INT PRIMARY KEY REFERENCES provider_nodes(id) ON DELETE CASCADE,
      battery_percent INT,
      is_charging BOOLEAN,
      battery_status TEXT,
      battery_health TEXT,
      battery_temperature_c NUMERIC,
      signal_percent INT,
      signal_dbm INT,
      signal_asu INT,
      signal_level INT,
      signal_label TEXT,
      network_operator TEXT,
      network_type_label TEXT,
      quota_remaining_gb NUMERIC,
      quota_total_gb NUMERIC,
      quota_expires_at TEXT,
      quota_label TEXT,
      ip TEXT,
      user_agent TEXT,
      last_seen_at TIMESTAMP DEFAULT NOW(),
      last_low_battery_alert_at TIMESTAMP
    )
  `);
  await pool.query("ALTER TABLE node_telemetry ADD COLUMN IF NOT EXISTS signal_percent INT");
  await pool.query("ALTER TABLE node_telemetry ADD COLUMN IF NOT EXISTS signal_dbm INT");
  await pool.query("ALTER TABLE node_telemetry ADD COLUMN IF NOT EXISTS signal_asu INT");
  await pool.query("ALTER TABLE node_telemetry ADD COLUMN IF NOT EXISTS signal_level INT");
  await pool.query("ALTER TABLE node_telemetry ADD COLUMN IF NOT EXISTS signal_label TEXT");
  await pool.query("ALTER TABLE node_telemetry ADD COLUMN IF NOT EXISTS network_operator TEXT");
  await pool.query("ALTER TABLE node_telemetry ADD COLUMN IF NOT EXISTS network_type_label TEXT");
  await pool.query("ALTER TABLE node_telemetry ADD COLUMN IF NOT EXISTS quota_remaining_gb NUMERIC");
  await pool.query("ALTER TABLE node_telemetry ADD COLUMN IF NOT EXISTS quota_total_gb NUMERIC");
  await pool.query("ALTER TABLE node_telemetry ADD COLUMN IF NOT EXISTS quota_expires_at TEXT");
  await pool.query("ALTER TABLE node_telemetry ADD COLUMN IF NOT EXISTS quota_label TEXT");
}

function cleanBase(url) {
  const raw = String(url || "").trim();
  if (raw.toLowerCase().startsWith("poll://")) return raw.replace(/\/+$/, "");
  return raw.replace(/\/+$/, "");
}

function defaultSecret(name) {
  return `${String(name || "node").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-secret-001`;
}

function pollingPresets() {
  return [
    { name: "TELKOMSEL-JKT-01", provider_name: "Telkomsel", network_type: "mobile" },
    { name: "XL-JKT-01", provider_name: "XL", network_type: "mobile" },
    { name: "INDOSAT-JKT-01", provider_name: "Indosat", network_type: "mobile" },
    { name: "TRI-JKT-01", provider_name: "Tri", network_type: "mobile" },
    { name: "SMARTFREN-JKT-01", provider_name: "Smartfren", network_type: "mobile" },
    { name: "BIZNET-JKT-01", provider_name: "Biznet", network_type: "broadband" },
    { name: "INDIHOME-JKT-01", provider_name: "IndiHome", network_type: "broadband" }
  ].map((n) => ({ ...n, endpoint_url: `poll://${n.name}`, secret_key: defaultSecret(n.name) }));
}

function exactBatteryPercent(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function radioGenerationLabel(value) {
  const raw = String(value || "").toLowerCase().trim();
  if (!raw) return "";
  if (raw.includes("nr") || raw.includes("5g")) return "5G";
  if (raw.includes("lte") || raw.includes("4g")) return "4G LTE";
  if (raw.includes("hspa") || raw.includes("hsdpa") || raw.includes("hsupa")) return "3G HSPA";
  if (raw.includes("umts") || raw.includes("wcdma") || raw.includes("3g")) return "3G";
  if (raw.includes("edge")) return "EDGE";
  if (raw.includes("gprs")) return "GPRS";
  if (raw.includes("gsm") || raw.includes("2g")) return "2G GSM";
  if (raw.includes("cdma") || raw.includes("evdo")) return "CDMA";
  return raw.toUpperCase();
}

function formatSignalQualityLabel(node) {
  if (node.signal_percent !== null && node.signal_percent !== undefined) return `${node.signal_percent}%`;
  if (node.signal_dbm !== null && node.signal_dbm !== undefined) return `${node.signal_dbm} dBm`;
  if (node.signal_level !== null && node.signal_level !== undefined) return `${node.signal_level}/4`;
  return "n/a";
}

function formatSignalLabel(node) {
  const radio = radioGenerationLabel(node.network_type_label || node.radio_type || "");
  if (radio) return radio;
  if (node.signal_label) return node.signal_label;
  return formatSignalQualityLabel(node);
}

function quotaStatus(remaining, total) {
  const r = Number(remaining);
  const t = Number(total);
  if (!Number.isFinite(r)) return "unknown";
  if (r <= 1) return "critical";
  if (r <= 3) return "warning";
  if (Number.isFinite(t) && t > 0 && r / t <= 0.1) return "warning";
  return "good";
}

function enrichNodeForUi(node) {
  const originalProviderName = node.provider_name;
  const originalNetworkType = node.network_type;
  const rawBatteryPercent = exactBatteryPercent(node.battery_percent);
  const hasBattery = rawBatteryPercent !== null && rawBatteryPercent !== undefined;
  const batteryLabel = hasBattery ? `${rawBatteryPercent}%` : "n/a";
  const chargingLabel = node.is_charging === null || node.is_charging === undefined ? "n/a" : node.is_charging ? "Yes" : "No";
  const lastSeenLabel = node.telemetry_last_seen_at ? new Date(node.telemetry_last_seen_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) : "never";
  const signalLabel = formatSignalLabel(node);
  const signalQualityLabel = formatSignalQualityLabel(node);
  const quotaRemaining = node.quota_remaining_gb === null || node.quota_remaining_gb === undefined ? null : Number(node.quota_remaining_gb);
  const quotaTotal = node.quota_total_gb === null || node.quota_total_gb === undefined ? null : Number(node.quota_total_gb);
  const quotaLabel = node.quota_label || (Number.isFinite(quotaRemaining) && Number.isFinite(quotaTotal) ? `${quotaRemaining} GB / ${quotaTotal} GB` : Number.isFinite(quotaRemaining) ? `${quotaRemaining} GB` : "n/a");
  const networkTypeParts = [originalNetworkType];
  if (node.network_type_label) networkTypeParts.push(radioGenerationLabel(node.network_type_label) || node.network_type_label);
  if (node.network_operator) networkTypeParts.push(node.network_operator);
  const quotaLine = quotaLabel !== "n/a" ? ` · Quota ${quotaLabel}${node.quota_expires_at ? ` exp ${node.quota_expires_at}` : ""}` : "";
  const iconLine = `${networkTypeParts.join(" · ")} · Signal ${signalLabel}${signalQualityLabel !== "n/a" ? ` (${signalQualityLabel})` : ""} · Battery ${batteryLabel} · Charging ${chargingLabel}${quotaLine}`;
  return {
    ...node,
    raw_provider_name: originalProviderName,
    raw_network_type: originalNetworkType,
    raw_battery_percent: rawBatteryPercent,
    battery_percent: rawBatteryPercent,
    provider_name: originalProviderName,
    network_type: iconLine,
    battery_label: batteryLabel,
    charging_label: chargingLabel,
    signal_label: signalLabel,
    signal_quality_label: signalQualityLabel,
    network_label: signalLabel,
    radio_type: signalLabel,
    quota_remaining_gb: quotaRemaining,
    quota_total_gb: quotaTotal,
    quota_label: quotaLabel,
    quota_status: quotaStatus(quotaRemaining, quotaTotal),
    last_seen_label: lastSeenLabel
  };
}

async function pingNode(node) {
  if (String(node.endpoint_url || "").toLowerCase().startsWith("poll://")) return { ok: true, mode: "polling", data: { ok: true, message: "Polling node waits for device agent heartbeat", node_name: node.name } };
  const started = Date.now();
  const url = `${cleanBase(node.endpoint_url)}/health`;
  const { data } = await axios.get(url, { timeout: 12000, headers: node.secret_key ? { "x-domain-radar-secret": node.secret_key } : {} });
  return { ok: true, latency_ms: Date.now() - started, data };
}

async function getPollingNodeHealth(nodeId) {
  const { rows } = await pool.query("SELECT last_seen_at FROM node_telemetry WHERE node_id=$1 LIMIT 1", [nodeId]);
  const lastSeenAt = rows[0]?.last_seen_at;
  if (!lastSeenAt) return { health: "waiting", reason: "waiting for device agent heartbeat" };
  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  if (Number.isFinite(ageMs) && ageMs <= 2 * 60 * 1000) return { health: "online", reason: "active polling heartbeat" };
  return { health: "waiting", reason: "polling heartbeat stale" };
}

router.get("/", async (req, res, next) => {
  try {
    await ensureNodeTable();
    const access = nodeAccessWhere(req, "n.");
    const { rows } = await pool.query(`
      SELECT n.*, t.battery_percent, t.is_charging, t.battery_status, t.battery_health, t.battery_temperature_c,
        t.signal_percent, t.signal_dbm, t.signal_asu, t.signal_level, t.signal_label, t.network_operator,
        t.network_type_label, t.quota_remaining_gb, t.quota_total_gb, t.quota_expires_at, t.quota_label,
        t.ip AS telemetry_ip, t.last_seen_at AS telemetry_last_seen_at, t.last_low_battery_alert_at
      FROM provider_nodes n
      LEFT JOIN node_telemetry t ON t.node_id = n.id
      WHERE ${access.sql}
      ORDER BY n.is_platform_node DESC, n.id DESC
    `, access.params);
    res.json(rows.map(enrichNodeForUi));
  } catch (err) { next(err); }
});

router.get("/presets", async (req, res) => res.json(pollingPresets()));

router.post("/presets", async (req, res, next) => {
  try {
    await ensureNodeTable();
    const user = currentUser(req);
    if (user?.role === "demo") return res.status(403).json({ error: "Demo account is read-only" });
    const inserted = [];
    for (const node of pollingPresets()) {
      const isPlatform = isSuperadmin(req);
      const ownerId = isPlatform ? null : user.userId;
      const { rows } = await pool.query(
        `INSERT INTO provider_nodes (user_id, name, provider_name, network_type, endpoint_url, secret_key, is_platform_node)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (user_id, name) DO UPDATE SET provider_name=EXCLUDED.provider_name, network_type=EXCLUDED.network_type, endpoint_url=EXCLUDED.endpoint_url, secret_key=EXCLUDED.secret_key, is_platform_node=EXCLUDED.is_platform_node
         RETURNING *`,
        [ownerId, node.name, node.provider_name, node.network_type, node.endpoint_url, node.secret_key, isPlatform]
      );
      inserted.push(rows[0]);
    }
    res.json({ ok: true, count: inserted.length, nodes: inserted });
  } catch (err) { next(err); }
});

router.post("/", async (req, res, next) => {
  try {
    await ensureNodeTable();
    const user = currentUser(req);
    if (user?.role === "demo") return res.status(403).json({ error: "Demo account is read-only" });
    const name = String(req.body.name || "").trim();
    const provider = String(req.body.provider_name || "").trim();
    const network = String(req.body.network_type || "broadband").trim();
    const endpoint = cleanBase(req.body.endpoint_url || "");
    const secret = String(req.body.secret_key || "").trim();
    if (!name || !provider || !endpoint) return res.status(400).json({ error: "Name, provider, and endpoint URL are required" });
    const isPlatform = Boolean(req.body.is_platform_node) && isSuperadmin(req);
    const ownerId = isPlatform ? null : user.userId;
    const { rows } = await pool.query(
      `INSERT INTO provider_nodes (user_id, name, provider_name, network_type, endpoint_url, secret_key, is_platform_node)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id, name) DO UPDATE SET provider_name=EXCLUDED.provider_name, network_type=EXCLUDED.network_type, endpoint_url=EXCLUDED.endpoint_url, secret_key=EXCLUDED.secret_key, is_platform_node=EXCLUDED.is_platform_node
       RETURNING *`,
      [ownerId, name, provider, network, endpoint, secret, isPlatform]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.post("/:id/ping", async (req, res, next) => {
  try {
    await ensureNodeTable();
    const access = nodeAccessWhere(req);
    const { rows } = await pool.query(`SELECT * FROM provider_nodes WHERE id=$${access.params.length + 1} AND ${access.sql}`, [...access.params, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Node not found" });
    try {
      const result = await pingNode(rows[0]);
      let health = "online";
      let reason = "ping ok";
      if (result.mode === "polling") {
        const polling = await getPollingNodeHealth(req.params.id);
        health = polling.health;
        reason = polling.reason;
      }
      await pool.query("UPDATE provider_nodes SET last_health_status=$1, last_health_reason=$2, last_ping_at=NOW() WHERE id=$3", [health, reason, req.params.id]);
      res.json({ ...result, health, reason });
    } catch (err) {
      await pool.query("UPDATE provider_nodes SET last_health_status='offline', last_ping_at=NOW() WHERE id=$1", [req.params.id]);
      res.json({ ok: false, error: err.message });
    }
  } catch (err) { next(err); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    await ensureNodeTable();
    const user = currentUser(req);
    if (user?.role === "demo") return res.status(403).json({ error: "Demo account is read-only" });
    const write = nodeWriteWhere(req);
    const { rows } = await pool.query(
      `UPDATE provider_nodes SET is_active=COALESCE($${write.params.length + 1},is_active) WHERE id=$${write.params.length + 2} AND ${write.sql} RETURNING *`,
      [...write.params, req.body.is_active, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Node not found" });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await ensureNodeTable();
    const user = currentUser(req);
    if (user?.role === "demo") return res.status(403).json({ error: "Demo account is read-only" });
    const write = nodeWriteWhere(req);
    await pool.query(`DELETE FROM provider_nodes WHERE id=$${write.params.length + 1} AND ${write.sql}`, [...write.params, req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = { router, ensureNodeTable, pingNode, cleanBase, pollingPresets };

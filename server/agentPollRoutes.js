const express = require("express");
const { randomUUID } = require("crypto");
const { pool } = require("./db");
const { ensureNodeTable } = require("./nodeRoutes");
const { sendTelegram } = require("./telegram");

const router = express.Router();
const LOW_BATTERY_THRESHOLD = Number(process.env.NODE_LOW_BATTERY_THRESHOLD || 25);
const LOW_BATTERY_ALERT_COOLDOWN_MINUTES = Number(process.env.NODE_LOW_BATTERY_ALERT_COOLDOWN_MINUTES || 60);

async function ensureTaskTable() {
  await ensureNodeTable();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_node_tasks (
      id TEXT PRIMARY KEY,
      node_id INT NOT NULL REFERENCES provider_nodes(id) ON DELETE CASCADE,
      domain TEXT NOT NULL,
      status TEXT DEFAULT 'queued',
      result JSONB,
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      claimed_at TIMESTAMP,
      completed_at TIMESTAMP
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_provider_node_tasks_node_status ON provider_node_tasks(node_id, status, created_at)");

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
}

function cleanName(name) {
  return String(name || "").trim();
}

async function findNode(nodeName, secretKey) {
  await ensureTaskTable();
  const { rows } = await pool.query(
    "SELECT * FROM provider_nodes WHERE name=$1 AND secret_key=$2 AND is_active=true LIMIT 1",
    [cleanName(nodeName), String(secretKey || "").trim()]
  );
  return rows[0] || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeTelemetry(raw = {}) {
  const batteryPercent = toNumberOrNull(raw.battery_percent);
  const temp = toNumberOrNull(raw.battery_temperature_c);
  const signalPercent = toNumberOrNull(raw.signal_percent);
  const signalDbm = toNumberOrNull(raw.signal_dbm);
  const signalAsu = toNumberOrNull(raw.signal_asu);
  const signalLevel = toNumberOrNull(raw.signal_level);

  const clippedSignalPercent = Number.isFinite(signalPercent)
    ? Math.max(0, Math.min(100, Math.round(signalPercent)))
    : null;

  return {
    battery_percent: Number.isFinite(batteryPercent) ? Math.max(0, Math.min(100, Math.round(batteryPercent))) : null,
    is_charging: typeof raw.is_charging === "boolean" ? raw.is_charging : null,
    battery_status: raw.battery_status ? String(raw.battery_status).slice(0, 80) : "",
    battery_health: raw.battery_health ? String(raw.battery_health).slice(0, 80) : "",
    battery_temperature_c: Number.isFinite(temp) ? temp : null,
    signal_percent: clippedSignalPercent,
    signal_dbm: Number.isFinite(signalDbm) ? Math.round(signalDbm) : null,
    signal_asu: Number.isFinite(signalAsu) ? Math.round(signalAsu) : null,
    signal_level: Number.isFinite(signalLevel) ? Math.max(0, Math.min(4, Math.round(signalLevel))) : null,
    signal_label: raw.signal_label ? String(raw.signal_label).slice(0, 80) : "",
    network_operator: raw.network_operator ? String(raw.network_operator).slice(0, 120) : "",
    network_type_label: raw.network_type_label ? String(raw.network_type_label).slice(0, 80) : ""
  };
}

async function upsertTelemetry(node, telemetryRaw, req) {
  await ensureTaskTable();
  const telemetry = normalizeTelemetry(telemetryRaw || {});
  const ip = req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "";
  const userAgent = req.headers["user-agent"] || "";

  await pool.query(
    `INSERT INTO node_telemetry (
        node_id, battery_percent, is_charging, battery_status, battery_health, battery_temperature_c,
        signal_percent, signal_dbm, signal_asu, signal_level, signal_label, network_operator, network_type_label,
        ip, user_agent, last_seen_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
      ON CONFLICT (node_id) DO UPDATE SET
        battery_percent=EXCLUDED.battery_percent,
        is_charging=EXCLUDED.is_charging,
        battery_status=EXCLUDED.battery_status,
        battery_health=EXCLUDED.battery_health,
        battery_temperature_c=EXCLUDED.battery_temperature_c,
        signal_percent=EXCLUDED.signal_percent,
        signal_dbm=EXCLUDED.signal_dbm,
        signal_asu=EXCLUDED.signal_asu,
        signal_level=EXCLUDED.signal_level,
        signal_label=EXCLUDED.signal_label,
        network_operator=EXCLUDED.network_operator,
        network_type_label=EXCLUDED.network_type_label,
        ip=EXCLUDED.ip,
        user_agent=EXCLUDED.user_agent,
        last_seen_at=NOW()`,
    [
      node.id,
      telemetry.battery_percent,
      telemetry.is_charging,
      telemetry.battery_status,
      telemetry.battery_health,
      telemetry.battery_temperature_c,
      telemetry.signal_percent,
      telemetry.signal_dbm,
      telemetry.signal_asu,
      telemetry.signal_level,
      telemetry.signal_label,
      telemetry.network_operator,
      telemetry.network_type_label,
      String(ip).slice(0, 200),
      String(userAgent).slice(0, 300)
    ]
  );

  if (telemetry.battery_percent !== null && telemetry.battery_percent <= LOW_BATTERY_THRESHOLD && telemetry.is_charging !== true) {
    const { rows } = await pool.query("SELECT last_low_battery_alert_at FROM node_telemetry WHERE node_id=$1", [node.id]);
    const last = rows[0]?.last_low_battery_alert_at ? new Date(rows[0].last_low_battery_alert_at).getTime() : 0;
    const cooldownMs = LOW_BATTERY_ALERT_COOLDOWN_MINUTES * 60 * 1000;
    if (!last || Date.now() - last > cooldownMs) {
      const message = `LOW BATTERY ALERT\n\nNode: ${node.name}\nProvider: ${node.provider_name}\nNetwork: ${node.network_type}\nBattery: ${telemetry.battery_percent}%\nCharging: No\nStatus: ${telemetry.battery_status || "unknown"}\nHealth: ${telemetry.battery_health || "unknown"}\nTime: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`;
      const sent = await sendTelegram(message);
      if (sent) {
        await pool.query("UPDATE node_telemetry SET last_low_battery_alert_at=NOW() WHERE node_id=$1", [node.id]);
      }
    }
  }
}

function normalizeDomainStatus(status) {
  const value = String(status || "unknown").toLowerCase().trim();
  if (["working", "normal", "online", "ok", "success"].includes(value)) return "working";
  if (["blocked", "block", "down", "offline"].includes(value)) return "blocked";
  if (["warning", "warn", "timeout", "error"].includes(value)) return "warning";
  return value || "unknown";
}

async function syncDomainStatusFromTask(taskId, node, result) {
  const { rows } = await pool.query(
    "SELECT domain FROM provider_node_tasks WHERE id=$1 AND node_id=$2 LIMIT 1",
    [taskId, node.id]
  );
  const domain = rows[0]?.domain;
  if (!domain) return;

  const status = normalizeDomainStatus(result?.status);
  const reason = String(result?.reason || result?.final_url || status || "checked").slice(0, 500);
  const lastStatus = `${node.name}: ${reason}`.slice(0, 700);

  await pool.query(
    `UPDATE domains
     SET global_status=$1,
         last_status=$2,
         last_checked_at=NOW()
     WHERE domain=$3`,
    [status, lastStatus, domain]
  );
}

async function enqueueNodeTask(node, domain) {
  await ensureTaskTable();
  const id = randomUUID();
  await pool.query(
    "INSERT INTO provider_node_tasks (id, node_id, domain, status) VALUES ($1,$2,$3,'queued')",
    [id, node.id, domain]
  );
  return id;
}

async function waitForNodeTask(taskId, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { rows } = await pool.query("SELECT * FROM provider_node_tasks WHERE id=$1", [taskId]);
    const task = rows[0];
    if (!task) return { status: "warning", reason: "Polling task disappeared", __polling_state: "error" };
    if (task.status === "done") return task.result || { status: "warning", reason: "Polling task returned empty result", __polling_state: "error" };
    if (task.status === "error") return { status: "warning", reason: task.error || "Polling task error", __polling_state: "error" };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await pool.query("UPDATE provider_node_tasks SET status='error', error='Node polling timeout' WHERE id=$1 AND status <> 'done'", [taskId]);
  return { status: "warning", reason: "Node polling timeout / no response from device", __polling_state: "timeout" };
}

router.post("/poll", async (req, res, next) => {
  try {
    const node = await findNode(req.body.node_name, req.body.secret_key);
    if (!node) return res.status(401).json({ error: "Invalid node credentials" });

    if (req.body.network_ok === false) {
      const reason = String(req.body.network_reason || "wrong network").slice(0, 200);
      await pool.query("ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS last_health_reason TEXT");
      await pool.query("UPDATE provider_nodes SET last_health_status='waiting', last_health_reason=$1, last_ping_at=NOW() WHERE id=$2", [reason, node.id]);
      await upsertTelemetry(node, req.body.telemetry || {}, req);
      return res.json({ ok: true, task: null, waiting: true, reason });
    }

    await pool.query("ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS last_health_reason TEXT");
    await pool.query("UPDATE provider_nodes SET last_health_status='online', last_health_reason=$1, last_ping_at=NOW() WHERE id=$2", [req.body.network_reason || "network matched", node.id]);
    await upsertTelemetry(node, req.body.telemetry || {}, req);

    const { rows } = await pool.query(
      `UPDATE provider_node_tasks
       SET status='claimed', claimed_at=NOW()
       WHERE id = (
         SELECT id FROM provider_node_tasks
         WHERE node_id=$1 AND status='queued'
         ORDER BY created_at ASC
         LIMIT 1
       )
       RETURNING id, domain`,
      [node.id]
    );

    if (!rows[0]) return res.json({ ok: true, task: null });
    res.json({ ok: true, task: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post("/result", async (req, res, next) => {
  try {
    const node = await findNode(req.body.node_name, req.body.secret_key);
    if (!node) return res.status(401).json({ error: "Invalid node credentials" });

    const taskId = String(req.body.task_id || "").trim();
    if (!taskId) return res.status(400).json({ error: "task_id required" });

    const result = req.body.result || {};

    const { rows: healthRows } = await pool.query(
      "SELECT last_health_status, last_health_reason FROM provider_nodes WHERE id=$1 LIMIT 1",
      [node.id]
    );
    const health = healthRows[0] || {};
    const healthReason = String(health.last_health_reason || "").toLowerCase();
    const waitingBecauseNetwork =
      String(health.last_health_status || "").toLowerCase() === "waiting" &&
      (healthReason.includes("wrong network") || healthReason.includes("network check failed"));

    if (waitingBecauseNetwork) {
      await pool.query(
        "UPDATE provider_node_tasks SET status='error', error=$1, completed_at=NOW() WHERE id=$2 AND node_id=$3",
        [health.last_health_reason || "wrong network", taskId, node.id]
      );
      await pool.query(
        "UPDATE provider_nodes SET last_health_status='waiting', last_ping_at=NOW() WHERE id=$1",
        [node.id]
      );
      return res.json({ ok: false, ignored: true, reason: health.last_health_reason || "wrong network" });
    }

    await pool.query(
      `UPDATE provider_node_tasks
       SET status='done', result=$1::jsonb, completed_at=NOW()
       WHERE id=$2 AND node_id=$3`,
      [JSON.stringify(result), taskId, node.id]
    );
    await syncDomainStatusFromTask(taskId, node, result);
    await pool.query("ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS last_health_reason TEXT");
    await pool.query("UPDATE provider_nodes SET last_health_status='online', last_health_reason='result submitted', last_ping_at=NOW() WHERE id=$1", [node.id]);
    await upsertTelemetry(node, req.body.telemetry || {}, req);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, ensureTaskTable, enqueueNodeTask, waitForNodeTask };

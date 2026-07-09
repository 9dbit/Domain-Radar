const axios = require("axios");
const { pool } = require("./db");
const { cleanBase } = require("./nodeRoutes");
const { enqueueNodeTask, waitForNodeTask } = require("./agentPollRoutes");

async function ensureProviderNodeTable() {
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
}

async function getActiveNodes(userId = null) {
  try {
    await ensureProviderNodeTable();
    if (userId) {
      const { rows } = await pool.query(
        "SELECT * FROM provider_nodes WHERE is_active=true AND (user_id=$1 OR is_platform_node=true) ORDER BY is_platform_node DESC, id ASC",
        [userId]
      );
      return rows;
    }
    const { rows } = await pool.query("SELECT * FROM provider_nodes WHERE is_active=true ORDER BY id ASC");
    return rows;
  } catch (err) {
    console.error("Provider node load error:", err.message);
    return [];
  }
}

function isPollingNode(node) {
  return String(node.endpoint_url || "").trim().toLowerCase().startsWith("poll://");
}

function normalizeNodeResult(node, data, latencyMs) {
  return {
    checker_type: `node:${node.network_type || "provider"}`,
    provider_name: node.provider_name || node.name,
    status: data.status || "warning",
    http_status: data.http_status || null,
    final_url: data.final_url || "",
    dns_result: data.dns_result || "",
    latency_ms: data.latency_ms || latencyMs,
    reason: data.reason || `Checked via ${node.name}`
  };
}

async function checkViaPollingNode(domain, node) {
  const started = Date.now();
  try {
    const taskId = await enqueueNodeTask(node, domain);
    const data = await waitForNodeTask(taskId, 45000);

    if (data.__polling_state === "timeout") {
      await pool.query("UPDATE provider_nodes SET last_health_status='waiting', last_ping_at=NOW() WHERE id=$1", [node.id]);
      return normalizeNodeResult(node, data, Date.now() - started);
    }

    if (data.__polling_state === "error") {
      await pool.query("UPDATE provider_nodes SET last_health_status='offline', last_ping_at=NOW() WHERE id=$1", [node.id]);
      return normalizeNodeResult(node, data, Date.now() - started);
    }

    await pool.query("UPDATE provider_nodes SET last_health_status='online', last_ping_at=NOW() WHERE id=$1", [node.id]);
    return normalizeNodeResult(node, data, Date.now() - started);
  } catch (err) {
    await pool.query("UPDATE provider_nodes SET last_health_status='offline', last_ping_at=NOW() WHERE id=$1", [node.id]).catch(() => {});
    return {
      checker_type: `node:${node.network_type || "provider"}`,
      provider_name: node.provider_name || node.name,
      status: "warning",
      http_status: null,
      final_url: "",
      dns_result: "",
      latency_ms: Date.now() - started,
      reason: `Polling node error: ${err.code || err.message}`
    };
  }
}

async function checkViaNode(domain, node) {
  if (isPollingNode(node)) return checkViaPollingNode(domain, node);

  const started = Date.now();
  try {
    const { data } = await axios.post(
      `${cleanBase(node.endpoint_url)}/check`,
      { domain },
      {
        timeout: 25000,
        headers: node.secret_key ? { "x-domain-radar-secret": node.secret_key } : {}
      }
    );
    await pool.query("UPDATE provider_nodes SET last_health_status='online', last_ping_at=NOW() WHERE id=$1", [node.id]);
    return normalizeNodeResult(node, data, Date.now() - started);
  } catch (err) {
    await pool.query("UPDATE provider_nodes SET last_health_status='offline', last_ping_at=NOW() WHERE id=$1", [node.id]).catch(() => {});
    return {
      checker_type: `node:${node.network_type || "provider"}`,
      provider_name: node.provider_name || node.name,
      status: "warning",
      http_status: null,
      final_url: "",
      dns_result: "",
      latency_ms: Date.now() - started,
      reason: `Node error: ${err.code || err.message}`
    };
  }
}

module.exports = { getActiveNodes, checkViaNode, isPollingNode };

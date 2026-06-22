const express = require("express");
const { randomUUID } = require("crypto");
const { pool } = require("./db");
const { ensureNodeTable } = require("./nodeRoutes");

const router = express.Router();

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

    await pool.query("UPDATE provider_nodes SET last_health_status='online', last_ping_at=NOW() WHERE id=$1", [node.id]);

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

    await pool.query(
      `UPDATE provider_node_tasks
       SET status='done', result=$1::jsonb, completed_at=NOW()
       WHERE id=$2 AND node_id=$3`,
      [JSON.stringify(req.body.result || {}), taskId, node.id]
    );
    await pool.query("UPDATE provider_nodes SET last_health_status='online', last_ping_at=NOW() WHERE id=$1", [node.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, ensureTaskTable, enqueueNodeTask, waitForNodeTask };

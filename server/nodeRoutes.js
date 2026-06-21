const express = require("express");
const axios = require("axios");
const { pool } = require("./db");

const router = express.Router();

async function ensureNodeTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_nodes (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      provider_name TEXT NOT NULL,
      network_type TEXT DEFAULT 'broadband',
      endpoint_url TEXT NOT NULL,
      secret_key TEXT DEFAULT '',
      is_active BOOLEAN DEFAULT TRUE,
      last_health_status TEXT DEFAULT 'unknown',
      last_ping_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

function cleanBase(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

async function pingNode(node) {
  const started = Date.now();
  const url = `${cleanBase(node.endpoint_url)}/health`;
  const { data } = await axios.get(url, {
    timeout: 12000,
    headers: node.secret_key ? { "x-domain-radar-secret": node.secret_key } : {}
  });
  return { ok: true, latency_ms: Date.now() - started, data };
}

router.get("/", async (req, res, next) => {
  try {
    await ensureNodeTable();
    const { rows } = await pool.query("SELECT * FROM provider_nodes ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    await ensureNodeTable();
    const name = String(req.body.name || "").trim();
    const provider = String(req.body.provider_name || "").trim();
    const network = String(req.body.network_type || "broadband").trim();
    const endpoint = cleanBase(req.body.endpoint_url || "");
    const secret = String(req.body.secret_key || "").trim();
    if (!name || !provider || !endpoint) return res.status(400).json({ error: "Name, provider, and endpoint URL are required" });

    const { rows } = await pool.query(
      `INSERT INTO provider_nodes (name, provider_name, network_type, endpoint_url, secret_key)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (name) DO UPDATE SET provider_name=EXCLUDED.provider_name, network_type=EXCLUDED.network_type, endpoint_url=EXCLUDED.endpoint_url, secret_key=EXCLUDED.secret_key
       RETURNING *`,
      [name, provider, network, endpoint, secret]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post("/:id/ping", async (req, res, next) => {
  try {
    await ensureNodeTable();
    const { rows } = await pool.query("SELECT * FROM provider_nodes WHERE id=$1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Node not found" });

    try {
      const result = await pingNode(rows[0]);
      await pool.query("UPDATE provider_nodes SET last_health_status='online', last_ping_at=NOW() WHERE id=$1", [req.params.id]);
      res.json(result);
    } catch (err) {
      await pool.query("UPDATE provider_nodes SET last_health_status='offline', last_ping_at=NOW() WHERE id=$1", [req.params.id]);
      res.json({ ok: false, error: err.message });
    }
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    await ensureNodeTable();
    const { is_active } = req.body;
    const { rows } = await pool.query(
      "UPDATE provider_nodes SET is_active=COALESCE($1,is_active) WHERE id=$2 RETURNING *",
      [is_active, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await ensureNodeTable();
    await pool.query("DELETE FROM provider_nodes WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, ensureNodeTable, pingNode, cleanBase };

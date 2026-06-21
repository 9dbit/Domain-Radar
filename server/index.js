require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const { pool } = require("./db");
const { runChecks, startScheduler } = require("./scheduler");
const { normalizeDomain } = require("./checker");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/overview", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT 
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE global_status='working')::int AS working,
      COUNT(*) FILTER (WHERE global_status='warning')::int AS warning,
      COUNT(*) FILTER (WHERE global_status='blocked')::int AS blocked,
      MAX(last_checked_at) AS last_checked
    FROM domains
  `);
  res.json(rows[0]);
});

app.get("/api/domains", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM domains ORDER BY id DESC");
  res.json(rows);
});

app.post("/api/domains", async (req, res) => {
  const domain = normalizeDomain(req.body.domain || "");
  const project = req.body.project_name || "";
  if (!domain) return res.status(400).json({ error: "Domain required" });

  const { rows } = await pool.query(
    `INSERT INTO domains (domain, project_name) VALUES ($1,$2)
     ON CONFLICT (domain) DO UPDATE SET project_name=EXCLUDED.project_name
     RETURNING *`,
    [domain, project]
  );
  res.json(rows[0]);
});

app.post("/api/domains/bulk", async (req, res) => {
  const items = String(req.body.text || "")
    .split(/\r?\n/)
    .map(normalizeDomain)
    .filter(Boolean);

  const inserted = [];
  for (const domain of items) {
    const { rows } = await pool.query(
      `INSERT INTO domains (domain) VALUES ($1)
       ON CONFLICT (domain) DO NOTHING
       RETURNING *`,
      [domain]
    );
    if (rows[0]) inserted.push(rows[0]);
  }
  res.json({ inserted_count: inserted.length, inserted });
});

app.patch("/api/domains/:id", async (req, res) => {
  const { is_active, project_name } = req.body;
  const { rows } = await pool.query(
    `UPDATE domains 
     SET is_active=COALESCE($1,is_active), project_name=COALESCE($2,project_name)
     WHERE id=$3 RETURNING *`,
    [is_active, project_name, req.params.id]
  );
  res.json(rows[0]);
});

app.delete("/api/domains/:id", async (req, res) => {
  await pool.query("DELETE FROM domains WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

app.get("/api/proxies", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM proxies ORDER BY id DESC");
  res.json(rows);
});

app.post("/api/proxies", async (req, res) => {
  const { name, provider_name, proxy_url, proxy_type } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO proxies (name, provider_name, proxy_url, proxy_type)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, provider_name, proxy_url, proxy_type || "http"]
  );
  res.json(rows[0]);
});

app.get("/api/results", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT r.*, d.domain
    FROM check_results r
    JOIN domains d ON d.id = r.domain_id
    ORDER BY r.checked_at DESC
    LIMIT 300
  `);
  res.json(rows);
});

app.post("/api/check/manual", async (req, res) => {
  await runChecks();
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, "../dist")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../dist/index.html"));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on ${port}`);
  startScheduler();
});

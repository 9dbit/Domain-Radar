require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const { pool } = require("./db");
const { runChecks, startScheduler } = require("./scheduler");
const { normalizeDomain } = require("./checker");
const settingsRoutes = require("./settingsRoutes");
const { loadSettings } = require("./settingsStore");
const { sendTelegram } = require("./telegram");

const app = express();
const sessionSecret = process.env.SESSION_SECRET || "domain-radar-dev-session-secret";
const adminPassword = process.env.ADMIN_PASSWORD || "";

app.set("trust proxy", 1);
app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "2mb" }));
app.use(
  session({
    name: "domain_radar_sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: "auto",
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

function requireAdmin(req, res, next) {
  if (!adminPassword) return next();
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/"/g, '""');
  return /[",\n\r]/.test(text) ? `"${text}"` : text;
}

function sendCsv(res, filename, rows) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const body = [headers.join(",")]
    .concat(rows.map((row) => headers.map((h) => csvEscape(row[h])).join(",")))
    .join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
  res.send(body);
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected", auth_enabled: Boolean(adminPassword) });
  } catch (err) {
    res.status(500).json({ ok: false, database: "error", message: err.message });
  }
});

app.get("/api/auth/me", (req, res) => {
  res.json({ authenticated: !adminPassword || Boolean(req.session && req.session.isAdmin) });
});

app.post("/api/auth/login", (req, res) => {
  if (!adminPassword) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }

  if (String(req.body.password || "") !== adminPassword) {
    return res.status(401).json({ error: "Invalid password" });
  }

  req.session.isAdmin = true;
  res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("domain_radar_sid");
    res.json({ ok: true });
  });
});

app.use("/api/settings", requireAdmin, settingsRoutes);

app.post("/api/telegram/test", requireAdmin, async (req, res) => {
  const message = `DOMAIN RADAR TEST\n\nTelegram alert is working.\nTime: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`;
  const sent = await sendTelegram(message);
  res.json({ ok: sent });
});

app.get("/api/overview", requireAdmin, async (req, res) => {
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

app.get("/api/domains", requireAdmin, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM domains ORDER BY id DESC");
  res.json(rows);
});

app.post("/api/domains", requireAdmin, async (req, res) => {
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

app.post("/api/domains/bulk", requireAdmin, async (req, res) => {
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

app.patch("/api/domains/:id", requireAdmin, async (req, res) => {
  const { domain, is_active, project_name } = req.body;
  const cleanDomain = domain !== undefined ? normalizeDomain(domain) : undefined;
  const { rows } = await pool.query(
    `UPDATE domains 
     SET domain=COALESCE($1,domain), is_active=COALESCE($2,is_active), project_name=COALESCE($3,project_name)
     WHERE id=$4 RETURNING *`,
    [cleanDomain || null, is_active, project_name, req.params.id]
  );
  res.json(rows[0]);
});

app.delete("/api/domains/:id", requireAdmin, async (req, res) => {
  await pool.query("DELETE FROM domains WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

app.get("/api/proxies", requireAdmin, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM proxies ORDER BY id DESC");
  res.json(rows);
});

app.post("/api/proxies", requireAdmin, async (req, res) => {
  const { name, provider_name, proxy_url, proxy_type } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO proxies (name, provider_name, proxy_url, proxy_type)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, provider_name, proxy_url, proxy_type || "http"]
  );
  res.json(rows[0]);
});

app.delete("/api/proxies/:id", requireAdmin, async (req, res) => {
  await pool.query("DELETE FROM proxies WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

app.get("/api/results", requireAdmin, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT r.*, d.domain
    FROM check_results r
    JOIN domains d ON d.id = r.domain_id
    ORDER BY r.checked_at DESC
    LIMIT 300
  `);
  res.json(rows);
});

app.get("/api/export/domains.csv", requireAdmin, async (req, res) => {
  const { rows } = await pool.query("SELECT id, domain, project_name, is_active, global_status, last_status, last_checked_at, created_at FROM domains ORDER BY id DESC");
  sendCsv(res, "domains.csv", rows);
});

app.get("/api/export/results.csv", requireAdmin, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT r.checked_at, d.domain, r.provider_name, r.checker_type, r.status, r.http_status, r.latency_ms, r.final_url, r.reason
    FROM check_results r
    JOIN domains d ON d.id = r.domain_id
    ORDER BY r.checked_at DESC
    LIMIT 5000
  `);
  sendCsv(res, "check-results.csv", rows);
});

app.post("/api/check/manual", requireAdmin, async (req, res) => {
  await runChecks();
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));
app.get("*", (req, res) => {
  const indexPath = path.join(distPath, "index.html");
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.json({ ok: true, message: "API server is running. Run npm run client for the dashboard during development." });
});

const port = process.env.PORT || 3000;

async function boot() {
  try {
    await loadSettings();
    console.log("Settings loaded from database");
  } catch (err) {
    console.error("Settings load failed, using env defaults:", err.message);
  }

  app.listen(port, () => {
    console.log(`Server running on ${port}`);
    startScheduler();
  });
}

boot();

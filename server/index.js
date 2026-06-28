require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const { pool } = require("./db");
const { runChecks, startScheduler, maybeAddProviderRegistryResult } = require("./scheduler");
const { normalizeDomain, checkDomain, calculateGlobalStatus } = require("./checker");
const settingsRoutes = require("./settingsRoutes");
const projectRoutes = require("./projectRoutes");
const rankRoutes = require("./rankRoutes");
const projectTelegramRoutes = require("./projectTelegramRoutes");
const trustpositifRoutes = require("./trustpositifRoutes");
const { router: nodeRoutes } = require("./nodeRoutes");
const { router: agentPollRoutes } = require("./agentPollRoutes");
const { getActiveNodes, checkViaNode } = require("./nodeChecker");
const { loadSettings } = require("./settingsStore");
const { sendTelegram, answerCallbackQuery, editMessageReplyMarkup } = require("./telegram");
const { markAcknowledged } = require("./noticeState");
const { normalizeEmail, isEmailWhitelistEnabled, isEmailAllowed } = require("./authAllowlist");

const app = express();
const sessionSecret = process.env.SESSION_SECRET || "domain-radar-dev-session-secret";
const adminPassword = process.env.ADMIN_PASSWORD || "";

app.set("trust proxy", 1);
app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "2mb" }));
app.use(session({ name: "domain_radar_sid", secret: sessionSecret, resave: false, saveUninitialized: false, proxy: true, cookie: { httpOnly: true, sameSite: "lax", secure: "auto", maxAge: 1000 * 60 * 60 * 24 * 7 } }));

function requireAdmin(req, res, next) { if (!adminPassword) return next(); if (req.session && req.session.isAdmin) return next(); return res.status(401).json({ error: "Unauthorized" }); }
function csvEscape(value) { if (value === null || value === undefined) return ""; const text = String(value).replace(/"/g, '""'); return /[",\n\r]/.test(text) ? `"${text}"` : text; }
function sendCsv(res, filename, rows) { const headers = rows.length ? Object.keys(rows[0]) : []; const body = [headers.join(",")].concat(rows.map((row) => headers.map((h) => csvEscape(row[h])).join(","))).join("\n"); res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`); res.send(body); }
function parseBulkLine(line) { const raw = String(line || "").trim(); if (!raw) return null; const parts = raw.split(/[,;\t]/).map((x) => x.trim()); return { domain: normalizeDomain(parts[0] || ""), project_name: parts.slice(1).join(" ") || "" }; }

async function runSingleDomainCheck(domainRow) {
  const proxies = (await pool.query("SELECT * FROM proxies WHERE is_active=true")).rows;
  const nodes = await getActiveNodes();
  const checks = [checkDomain(domainRow.domain, { type: "direct", provider_name: "Direct" })];
  for (const proxy of proxies) checks.push(checkDomain(domainRow.domain, { type: "proxy", provider_name: proxy.provider_name || proxy.name, proxy }));
  for (const node of nodes) checks.push(checkViaNode(domainRow.domain, node));
  const results = await Promise.all(checks);
  await maybeAddProviderRegistryResult(domainRow, results);
  for (const result of results) {
    await pool.query(`INSERT INTO check_results (domain_id, checker_type, provider_name, status, http_status, final_url, dns_result, latency_ms, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [domainRow.id, result.checker_type, result.provider_name, result.status, result.http_status, result.final_url, result.dns_result, result.latency_ms, result.reason]);
  }
  const oldStatus = domainRow.global_status || "unknown";
  const newStatus = calculateGlobalStatus(results);
  await pool.query("UPDATE domains SET last_status=$1, global_status=$2, last_checked_at=NOW() WHERE id=$3", [oldStatus, newStatus, domainRow.id]);
  if (oldStatus !== newStatus) {
    const message = `DOMAIN STATUS CHANGED\n\nDomain: ${domainRow.domain}\nOld: ${oldStatus}\nNew: ${newStatus}\nMode: Single manual check`;
    const sent = await sendTelegram(message);
    await pool.query("INSERT INTO alerts (domain_id, old_status, new_status, message, sent_to_telegram) VALUES ($1,$2,$3,$4,$5)", [domainRow.id, oldStatus, newStatus, message, sent]);
  }
  return { old_status: oldStatus, new_status: newStatus, results };
}

app.get("/api/health", async (req, res) => { try { await pool.query("SELECT 1"); res.json({ ok: true, database: "connected", auth_enabled: Boolean(adminPassword), email_whitelist_enabled: isEmailWhitelistEnabled() }); } catch (err) { res.status(500).json({ ok: false, database: "error", message: err.message }); } });
app.get("/api/auth/me", (req, res) => res.json({ authenticated: !adminPassword || Boolean(req.session && req.session.isAdmin), email: req.session?.adminEmail || "" }));
app.post("/api/auth/login", (req, res) => { if (!adminPassword) { req.session.isAdmin = true; req.session.adminEmail = normalizeEmail(req.body.email || ""); return res.json({ ok: true }); } const email = normalizeEmail(req.body.email || ""); if (String(req.body.password || "") !== adminPassword) return res.status(401).json({ error: "Invalid password" }); if (isEmailWhitelistEnabled() && !email) return res.status(401).json({ error: "Email required" }); if (!isEmailAllowed(email)) return res.status(403).json({ error: "Email not whitelisted" }); req.session.isAdmin = true; req.session.adminEmail = email; res.json({ ok: true, email }); });
app.post("/api/auth/logout", (req, res) => { req.session.destroy(() => { res.clearCookie("domain_radar_sid"); res.json({ ok: true }); }); });

app.use("/api/agent", agentPollRoutes);
app.use("/api/settings", requireAdmin, settingsRoutes);
app.use("/api/projects", requireAdmin, projectRoutes);
app.use("/api/rank", requireAdmin, rankRoutes);
app.use("/api/nodes", requireAdmin, nodeRoutes);
app.use("/api/project-telegram", requireAdmin, projectTelegramRoutes);
app.use("/api", requireAdmin, trustpositifRoutes);

app.post("/api/telegram/webhook", async (req, res) => {
  try {
    const callback = req.body && req.body.callback_query;
    if (!callback || !callback.data) return res.json({ ok: true });

    const parts = String(callback.data).split(":");
    if (parts[0] !== "noticed") return res.json({ ok: true });

    const domainId = Number(parts[1]);
    const status = parts[2] || "blocked";
    if (!Number.isFinite(domainId) || status !== "blocked") {
      await answerCallbackQuery(callback.id, "Invalid notice");
      return res.json({ ok: true });
    }

    await markAcknowledged(domainId, callback.from || {});
    await answerCallbackQuery(callback.id, "Noticed. Blocked alert acknowledged.");

    const chatId = callback.message?.chat?.id;
    const messageId = callback.message?.message_id;
    if (chatId && messageId) {
      await editMessageReplyMarkup(chatId, messageId, {
        inline_keyboard: [[{ text: "✅ Noticed", callback_data: "noticed_done" }]]
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Telegram webhook error:", err);
    res.json({ ok: false });
  }
});

app.post("/api/telegram/test", requireAdmin, async (req, res) => { const message = `DOMAIN RADAR TEST\n\nTelegram alert is working.\nTime: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`; const sent = await sendTelegram(message); res.json({ ok: sent }); });
app.get("/api/overview", requireAdmin, async (req, res) => { const { rows } = await pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE global_status='working')::int AS working, COUNT(*) FILTER (WHERE global_status='warning')::int AS warning, COUNT(*) FILTER (WHERE global_status='blocked')::int AS blocked, MAX(last_checked_at) AS last_checked FROM domains`); res.json(rows[0]); });
app.get("/api/alerts", requireAdmin, async (req, res) => { const { rows } = await pool.query(`SELECT a.*, d.domain, d.project_name FROM alerts a LEFT JOIN domains d ON d.id = a.domain_id ORDER BY a.created_at DESC LIMIT 100`); res.json(rows); });
app.get("/api/domains", requireAdmin, async (req, res) => { const { rows } = await pool.query("SELECT * FROM domains ORDER BY id DESC"); res.json(rows); });
app.post("/api/domains", requireAdmin, async (req, res) => { const domain = normalizeDomain(req.body.domain || ""); const project = req.body.project_name || ""; if (!domain) return res.status(400).json({ error: "Domain required" }); const { rows } = await pool.query(`INSERT INTO domains (domain, project_name) VALUES ($1,$2) ON CONFLICT (domain) DO UPDATE SET project_name=EXCLUDED.project_name RETURNING *`, [domain, project]); res.json(rows[0]); });
app.post("/api/domains/bulk", requireAdmin, async (req, res) => { const items = String(req.body.text || "").split(/\r?\n/).map(parseBulkLine).filter((x) => x && x.domain); const inserted = []; for (const item of items) { const { rows } = await pool.query(`INSERT INTO domains (domain, project_name) VALUES ($1,$2) ON CONFLICT (domain) DO UPDATE SET project_name=COALESCE(NULLIF(EXCLUDED.project_name,''), domains.project_name) RETURNING *`, [item.domain, item.project_name]); if (rows[0]) inserted.push(rows[0]); } res.json({ inserted_count: inserted.length, inserted }); });
app.patch("/api/domains/:id", requireAdmin, async (req, res) => { const { domain, is_active, project_name } = req.body; const cleanDomain = domain !== undefined ? normalizeDomain(domain) : undefined; const { rows } = await pool.query(`UPDATE domains SET domain=COALESCE($1,domain), is_active=COALESCE($2,is_active), project_name=COALESCE($3,project_name) WHERE id=$4 RETURNING *`, [cleanDomain || null, is_active, project_name, req.params.id]); res.json(rows[0]); });
app.delete("/api/domains/:id", requireAdmin, async (req, res) => { await pool.query("DELETE FROM domains WHERE id=$1", [req.params.id]); res.json({ ok: true }); });
app.get("/api/proxies", requireAdmin, async (req, res) => { const { rows } = await pool.query("SELECT * FROM proxies ORDER BY id DESC"); res.json(rows); });
app.post("/api/proxies", requireAdmin, async (req, res) => { const { name, provider_name, proxy_url, proxy_type } = req.body; const { rows } = await pool.query(`INSERT INTO proxies (name, provider_name, proxy_url, proxy_type) VALUES ($1,$2,$3,$4) RETURNING *`, [name, provider_name, proxy_url, proxy_type || "http"]); res.json(rows[0]); });
app.delete("/api/proxies/:id", requireAdmin, async (req, res) => { await pool.query("DELETE FROM proxies WHERE id=$1", [req.params.id]); res.json({ ok: true }); });
app.get("/api/results", requireAdmin, async (req, res) => { const { rows } = await pool.query(`SELECT r.*, d.domain FROM check_results r JOIN domains d ON d.id = r.domain_id ORDER BY r.checked_at DESC LIMIT 300`); res.json(rows); });
app.get("/api/export/domains.csv", requireAdmin, async (req, res) => { const { rows } = await pool.query("SELECT id, domain, project_name, is_active, global_status, last_status, last_checked_at, created_at FROM domains ORDER BY id DESC"); sendCsv(res, "domains.csv", rows); });
app.get("/api/export/results.csv", requireAdmin, async (req, res) => { const { rows } = await pool.query(`SELECT r.checked_at, d.domain, r.provider_name, r.checker_type, r.status, r.http_status, r.latency_ms, r.final_url, r.reason FROM check_results r JOIN domains d ON d.id = r.domain_id ORDER BY r.checked_at DESC LIMIT 5000`); sendCsv(res, "check-results.csv", rows); });
app.post("/api/check/manual", requireAdmin, async (req, res) => { await runChecks(); res.json({ ok: true }); });
app.post("/api/check/domain/:id", requireAdmin, async (req, res) => { const { rows } = await pool.query("SELECT * FROM domains WHERE id=$1", [req.params.id]); if (!rows[0]) return res.status(404).json({ error: "Domain not found" }); const result = await runSingleDomainCheck(rows[0]); res.json({ ok: true, ...result }); });

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: err.message || "Internal server error" }); });
const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));
app.get("*", (req, res) => { const indexPath = path.join(distPath, "index.html"); if (fs.existsSync(indexPath)) return res.sendFile(indexPath); res.json({ ok: true, message: "API server is running. Run npm run client for the dashboard during development." }); });
const port = process.env.PORT || 3000;
async function boot() { try { await loadSettings(); console.log("Settings loaded from database"); } catch (err) { console.error("Settings load failed, using env defaults:", err.message); } app.listen(port, () => { console.log(`Server running on ${port}`); startScheduler(); }); }
boot();

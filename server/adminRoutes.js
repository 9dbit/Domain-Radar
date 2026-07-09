const express = require("express");
const { pool } = require("./db");
const { getPlan, listPlans } = require("./plans");
const { ensureBillingTables, markInvoicePaid } = require("./billingStore");
const { getUsage } = require("./planQuota");
const { getUser, requestPasswordReset } = require("./authService");

const router = express.Router();

function isSuperadmin(req) {
  const user = req.user || getUser(req);
  return user?.role === "superadmin" || user?.isSuperadmin;
}

function requireSuperadmin(req, res, next) {
  if (isSuperadmin(req)) return next();
  return res.status(403).json({ error: "Superadmin only" });
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/"/g, '""');
  return /[",\n\r]/.test(text) ? `"${text}"` : text;
}

function sendCsv(res, filename, rows) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const body = [headers.join(",")].concat(rows.map((row) => headers.map((h) => csvEscape(row[h])).join(","))).join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
  res.send(body);
}

async function ensureUserAdminColumns() {
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended BOOLEAN DEFAULT false");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()");
}

async function merchantUsage(userId) {
  return getUsage(userId).catch(() => ({ domains: 0, projects: 0, nodes: 0, rank_groups: 0 }));
}

router.use(requireSuperadmin);

router.get("/plans", (req, res) => {
  res.json({ plans: listPlans() });
});

router.get("/merchants", async (req, res, next) => {
  try {
    await ensureBillingTables();
    await ensureUserAdminColumns();
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.name, u.role, u.email_verified, u.suspended, u.last_active_at, u.created_at,
        COALESCE(s.plan, 'free') AS plan,
        COALESCE(s.status, 'active') AS subscription_status,
        s.current_period_end,
        COUNT(i.id)::int AS invoice_count,
        COUNT(i.id) FILTER (WHERE i.status='paid')::int AS paid_invoice_count,
        COUNT(i.id) FILTER (WHERE i.status='pending')::int AS pending_invoice_count,
        MAX(i.created_at) AS last_invoice_at
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id=u.id
      LEFT JOIN billing_invoices i ON i.user_id=u.id
      WHERE u.role <> 'superadmin'
      GROUP BY u.id, s.plan, s.status, s.current_period_end
      ORDER BY u.created_at DESC
      LIMIT 500
    `);
    const merchants = [];
    for (const row of rows) {
      const usage = await merchantUsage(row.id);
      const plan = getPlan(row.plan);
      merchants.push({ ...row, usage, limits: plan.limits, plan_name: plan.name });
    }
    res.json({ merchants });
  } catch (err) { next(err); }
});

router.get("/merchants.csv", async (req, res, next) => {
  try {
    await ensureBillingTables();
    await ensureUserAdminColumns();
    const { rows } = await pool.query(`
      SELECT u.email, u.name, u.role, u.email_verified, u.suspended, COALESCE(s.plan,'free') AS plan,
        COALESCE(s.status,'active') AS subscription_status, s.current_period_end,
        COUNT(i.id)::int AS invoice_count,
        COUNT(i.id) FILTER (WHERE i.status='paid')::int AS paid_invoice_count,
        COUNT(i.id) FILTER (WHERE i.status='pending')::int AS pending_invoice_count,
        u.last_active_at, u.created_at
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id=u.id
      LEFT JOIN billing_invoices i ON i.user_id=u.id
      WHERE u.role <> 'superadmin'
      GROUP BY u.id, s.plan, s.status, s.current_period_end
      ORDER BY u.created_at DESC
    `);
    const out = [];
    for (const row of rows) {
      const usage = await merchantUsage((await pool.query("SELECT id FROM users WHERE email=$1", [row.email])).rows[0]?.id);
      out.push({ ...row, domains: usage.domains, projects: usage.projects, nodes: usage.nodes, rank_groups: usage.rank_groups });
    }
    sendCsv(res, "merchants.csv", out);
  } catch (err) { next(err); }
});

router.get("/invoices.csv", async (req, res, next) => {
  try {
    await ensureBillingTables();
    const { rows } = await pool.query(`
      SELECT i.id, u.email, i.plan, i.amount_idr, i.currency, i.status, i.gateway, i.gateway_reference, i.payment_url,
        i.expires_at, i.paid_at, i.created_at
      FROM billing_invoices i
      LEFT JOIN users u ON u.id=i.user_id
      ORDER BY i.created_at DESC
      LIMIT 5000
    `);
    sendCsv(res, "billing-invoices.csv", rows);
  } catch (err) { next(err); }
});

router.get("/merchants/:id", async (req, res, next) => {
  try {
    await ensureBillingTables();
    await ensureUserAdminColumns();
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.name, u.role, u.email_verified, u.suspended, u.last_active_at, u.created_at,
        COALESCE(s.plan, 'free') AS plan,
        COALESCE(s.status, 'active') AS subscription_status,
        s.current_period_start, s.current_period_end
      FROM users u
      LEFT JOIN subscriptions s ON s.user_id=u.id
      WHERE u.id=$1 AND u.role <> 'superadmin'
      LIMIT 1
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Merchant not found" });
    const invoices = (await pool.query("SELECT * FROM billing_invoices WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [req.params.id])).rows;
    const usage = await merchantUsage(req.params.id);
    const plan = getPlan(rows[0].plan);
    res.json({ merchant: { ...rows[0], usage, limits: plan.limits, plan_name: plan.name }, invoices });
  } catch (err) { next(err); }
});

router.patch("/merchants/:id", async (req, res, next) => {
  try {
    await ensureBillingTables();
    await ensureUserAdminColumns();
    const updates = [];
    const values = [];
    if (req.body.suspended !== undefined) {
      values.push(Boolean(req.body.suspended));
      updates.push(`suspended=$${values.length}`);
    }
    if (req.body.name !== undefined) {
      values.push(String(req.body.name || "").trim());
      updates.push(`name=$${values.length}`);
    }
    if (!updates.length) return res.status(400).json({ error: "Nothing to update" });
    values.push(req.params.id);
    const { rows } = await pool.query(`UPDATE users SET ${updates.join(", ")}, updated_at=NOW() WHERE id=$${values.length} AND role <> 'superadmin' RETURNING id,email,name,role,email_verified,suspended,last_active_at,created_at`, values);
    if (!rows[0]) return res.status(404).json({ error: "Merchant not found" });
    res.json({ ok: true, merchant: rows[0] });
  } catch (err) { next(err); }
});

router.post("/merchants/:id/send-reset", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT email FROM users WHERE id=$1 AND role <> 'superadmin' LIMIT 1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Merchant not found" });
    const result = await requestPasswordReset(req, rows[0].email);
    await pool.query(`INSERT INTO billing_events (user_id, event_type, raw) VALUES ($1,'merchant.password_reset_requested',$2::jsonb)`, [req.params.id, JSON.stringify({ by: getUser(req)?.email || "superadmin", emailSent: result.emailSent })]).catch(() => {});
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

router.post("/merchants/:id/change-plan", async (req, res, next) => {
  try {
    await ensureBillingTables();
    const plan = getPlan(req.body.plan || "free");
    const { rows: users } = await pool.query("SELECT id,email FROM users WHERE id=$1 AND role <> 'superadmin' LIMIT 1", [req.params.id]);
    if (!users[0]) return res.status(404).json({ error: "Merchant not found" });
    const { rows } = await pool.query(`
      INSERT INTO subscriptions (user_id, plan, status, current_period_start, current_period_end, gateway, updated_at)
      VALUES ($1,$2,'active',NOW(),NOW() + INTERVAL '30 days','manual',NOW())
      ON CONFLICT (user_id) DO UPDATE SET plan=EXCLUDED.plan, status='active', current_period_start=NOW(), current_period_end=NOW() + INTERVAL '30 days', gateway='manual', updated_at=NOW()
      RETURNING *
    `, [req.params.id, plan.id]);
    await pool.query(`INSERT INTO billing_events (user_id, event_type, raw) VALUES ($1,'subscription.manual_change',$2::jsonb)`, [req.params.id, JSON.stringify({ plan: plan.id, by: getUser(req)?.email || "superadmin" })]);
    res.json({ ok: true, subscription: rows[0], plan });
  } catch (err) { next(err); }
});

router.post("/invoices/:id/confirm", async (req, res, next) => {
  try {
    await ensureBillingTables();
    const invoice = await markInvoicePaid(req.params.id, { manual_confirmed_by: getUser(req)?.email || "superadmin" });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    res.json({ ok: true, invoice });
  } catch (err) { next(err); }
});

router.get("/metrics", async (req, res, next) => {
  try {
    await ensureBillingTables();
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE role <> 'superadmin')::int AS merchants,
        COUNT(*) FILTER (WHERE role <> 'superadmin' AND suspended=true)::int AS suspended,
        COUNT(*) FILTER (WHERE role='demo')::int AS demo_accounts
      FROM users
    `);
    const planRows = (await pool.query(`SELECT plan, COUNT(*)::int AS count FROM subscriptions GROUP BY plan ORDER BY plan`)).rows;
    const invoiceRows = (await pool.query(`SELECT status, COUNT(*)::int AS count, COALESCE(SUM(amount_idr),0)::int AS amount_idr FROM billing_invoices GROUP BY status`)).rows;
    res.json({ overview: rows[0], plans: planRows, invoices: invoiceRows });
  } catch (err) { next(err); }
});

module.exports = router;

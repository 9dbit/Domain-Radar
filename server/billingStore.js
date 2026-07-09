const { pool } = require("./db");
const { getPlan } = require("./plans");

async function ensureBillingTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'active',
      current_period_start TIMESTAMP DEFAULT NOW(),
      current_period_end TIMESTAMP,
      gateway TEXT DEFAULT 'custom',
      gateway_customer_id TEXT DEFAULT '',
      gateway_subscription_id TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      plan TEXT NOT NULL,
      amount_idr INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'IDR',
      status TEXT NOT NULL DEFAULT 'pending',
      gateway TEXT DEFAULT 'custom',
      gateway_reference TEXT DEFAULT '',
      payment_url TEXT DEFAULT '',
      payment_instructions TEXT DEFAULT '',
      raw JSONB DEFAULT '{}'::jsonb,
      expires_at TIMESTAMP,
      paid_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_events (
      id SERIAL PRIMARY KEY,
      invoice_id UUID,
      user_id UUID,
      event_type TEXT NOT NULL,
      gateway_reference TEXT DEFAULT '',
      raw JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query("CREATE INDEX IF NOT EXISTS idx_billing_invoices_user_id ON billing_invoices(user_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_billing_invoices_gateway_reference ON billing_invoices(gateway_reference)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_billing_events_invoice_id ON billing_events(invoice_id)");
}

async function getSubscription(userId) {
  await ensureBillingTables();
  const { rows } = await pool.query("SELECT * FROM subscriptions WHERE user_id=$1 LIMIT 1", [userId]);
  if (rows[0]) return rows[0];
  const { rows: inserted } = await pool.query(
    `INSERT INTO subscriptions (user_id, plan, status)
     VALUES ($1, 'free', 'active')
     ON CONFLICT (user_id) DO UPDATE SET updated_at=NOW()
     RETURNING *`,
    [userId]
  );
  return inserted[0];
}

async function getBillingOverview(userId) {
  const subscription = await getSubscription(userId);
  const plan = getPlan(subscription.plan);
  const { rows: invoices } = await pool.query(
    "SELECT * FROM billing_invoices WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10",
    [userId]
  );
  return { subscription, plan, invoices };
}

async function createInvoiceRecord({ userId, plan, amountIdr, currency = "IDR", gatewayResult = {} }) {
  await ensureBillingTables();
  const { rows } = await pool.query(
    `INSERT INTO billing_invoices
     (user_id, plan, amount_idr, currency, status, gateway, gateway_reference, payment_url, payment_instructions, raw, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW() + INTERVAL '24 hours')
     RETURNING *`,
    [
      userId,
      plan,
      amountIdr,
      currency,
      gatewayResult.status || "pending",
      gatewayResult.gateway || "custom",
      gatewayResult.gateway_reference || "",
      gatewayResult.payment_url || "",
      gatewayResult.payment_instructions || "",
      JSON.stringify(gatewayResult.raw || gatewayResult || {})
    ]
  );
  return rows[0];
}

async function recordBillingEvent({ invoiceId = null, userId = null, eventType, gatewayReference = "", raw = {} }) {
  await ensureBillingTables();
  await pool.query(
    `INSERT INTO billing_events (invoice_id, user_id, event_type, gateway_reference, raw)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [invoiceId, userId, eventType, gatewayReference, JSON.stringify(raw || {})]
  );
}

async function markInvoicePaid(invoiceId, raw = {}) {
  await ensureBillingTables();
  const { rows } = await pool.query(
    `UPDATE billing_invoices
     SET status='paid', paid_at=NOW(), updated_at=NOW(), raw=COALESCE(raw,'{}'::jsonb) || $2::jsonb
     WHERE id=$1
     RETURNING *`,
    [invoiceId, JSON.stringify(raw || {})]
  );
  const invoice = rows[0];
  if (!invoice) return null;

  await pool.query(
    `INSERT INTO subscriptions (user_id, plan, status, current_period_start, current_period_end, gateway, updated_at)
     VALUES ($1,$2,'active',NOW(),NOW() + INTERVAL '30 days','custom',NOW())
     ON CONFLICT (user_id) DO UPDATE SET plan=EXCLUDED.plan, status='active', current_period_start=NOW(), current_period_end=NOW() + INTERVAL '30 days', updated_at=NOW()
     RETURNING *`,
    [invoice.user_id, invoice.plan]
  );
  await recordBillingEvent({ invoiceId: invoice.id, userId: invoice.user_id, eventType: "invoice.paid", gatewayReference: invoice.gateway_reference, raw });
  return invoice;
}

module.exports = {
  ensureBillingTables,
  getSubscription,
  getBillingOverview,
  createInvoiceRecord,
  recordBillingEvent,
  markInvoicePaid
};

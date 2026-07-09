const express = require("express");
const { getPlan, listPlans } = require("./plans");
const { createInvoice, verifyCallback, normalizeEvent } = require("./billingGateway");
const {
  ensureBillingTables,
  getBillingOverview,
  createInvoiceRecord,
  recordBillingEvent,
  markInvoicePaid
} = require("./billingStore");
const { getUser } = require("./authService");

const router = express.Router();

function currentUser(req) {
  return req.user || getUser(req);
}

function isSuperadmin(req) {
  return currentUser(req)?.role === "superadmin" || currentUser(req)?.isSuperadmin;
}

router.get("/plans", async (req, res, next) => {
  try {
    res.json({ plans: listPlans() });
  } catch (err) { next(err); }
});

router.get("/me", async (req, res, next) => {
  try {
    await ensureBillingTables();
    const user = currentUser(req);
    res.json(await getBillingOverview(user.userId));
  } catch (err) { next(err); }
});

router.post("/create-invoice", async (req, res, next) => {
  try {
    await ensureBillingTables();
    const user = currentUser(req);
    if (user?.role === "demo") return res.status(403).json({ error: "Demo account is read-only" });
    const plan = getPlan(req.body.plan || "starter");
    if (plan.id === "free") return res.status(400).json({ error: "Free plan does not require payment" });
    const gatewayResult = await createInvoice({ user, plan, amount: plan.price_idr, currency: plan.currency });
    const invoice = await createInvoiceRecord({ userId: user.userId, plan: plan.id, amountIdr: plan.price_idr, currency: plan.currency, gatewayResult });
    await recordBillingEvent({ invoiceId: invoice.id, userId: user.userId, eventType: "invoice.created", gatewayReference: invoice.gateway_reference, raw: gatewayResult });
    res.status(201).json({ ok: true, plan, invoice });
  } catch (err) { next(err); }
});

router.post("/webhook", async (req, res, next) => {
  try {
    await ensureBillingTables();
    const verified = verifyCallback(req);
    if (!verified.ok) return res.status(401).json({ error: "Invalid callback signature" });
    const event = normalizeEvent(req.body || {});
    await recordBillingEvent({ invoiceId: event.invoice_id, eventType: event.event_type, gatewayReference: event.gateway_reference, raw: event.raw });
    if (event.event_type === "invoice.paid" && event.invoice_id) {
      await markInvoicePaid(event.invoice_id, event.raw);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post("/manual-confirm", async (req, res, next) => {
  try {
    if (!isSuperadmin(req)) return res.status(403).json({ error: "Superadmin only" });
    const invoiceId = String(req.body.invoice_id || "").trim();
    if (!invoiceId) return res.status(400).json({ error: "invoice_id required" });
    const invoice = await markInvoicePaid(invoiceId, { manual_confirmed_by: currentUser(req)?.email || "superadmin" });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    res.json({ ok: true, invoice });
  } catch (err) { next(err); }
});

module.exports = router;

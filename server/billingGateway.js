const crypto = require("crypto");

function gatewayConfig() {
  return {
    gateway: process.env.PAYMENT_GATEWAY_NAME || "custom",
    baseUrl: process.env.PAYMENT_GATEWAY_BASE_URL || "",
    apiKey: process.env.PAYMENT_GATEWAY_API_KEY || "",
    secret: process.env.PAYMENT_GATEWAY_SECRET || "",
    callbackSecret: process.env.PAYMENT_GATEWAY_CALLBACK_SECRET || "",
    returnUrl: process.env.PAYMENT_GATEWAY_RETURN_URL || process.env.DOMAIN_RADAR_DASHBOARD_URL || ""
  };
}

function signPayload(payload, secret) {
  return crypto.createHmac("sha256", secret || "").update(JSON.stringify(payload || {})).digest("hex");
}

async function createInvoice({ user, plan, amount, currency = "IDR" }) {
  const config = gatewayConfig();
  const reference = `DR-${Date.now()}-${String(user.userId || user.id || "user").slice(0, 8)}`;

  // Adapter placeholder: when PAYMENT_GATEWAY_BASE_URL is configured,
  // replace this block with provider-specific HTTP create-invoice call.
  // Until then, return manual/mock payment instructions so marketing/demo flow can run safely.
  if (!config.baseUrl) {
    return {
      gateway: config.gateway,
      status: "pending",
      gateway_reference: reference,
      payment_url: config.returnUrl || "",
      payment_instructions: `Manual payment pending for ${plan.name}. Ref: ${reference}. Amount: ${currency} ${amount.toLocaleString("id-ID")}`,
      raw: { mode: "manual", reference, plan: plan.id, amount, currency }
    };
  }

  const payload = {
    reference,
    user_id: user.userId || user.id,
    email: user.email,
    plan: plan.id,
    amount,
    currency,
    return_url: config.returnUrl
  };

  // Deliberately no external fetch here yet. This keeps the adapter safe until real gateway docs are final.
  return {
    gateway: config.gateway,
    status: "pending",
    gateway_reference: reference,
    payment_url: `${config.baseUrl.replace(/\/$/, "")}/pay/${encodeURIComponent(reference)}`,
    payment_instructions: `Open payment URL for ref ${reference}`,
    raw: { mode: "configured-placeholder", payload, signature: signPayload(payload, config.secret) }
  };
}

function verifyCallback(req) {
  const config = gatewayConfig();
  if (!config.callbackSecret) return { ok: true, reason: "callback secret not configured" };
  const signature = req.headers["x-gateway-signature"] || req.headers["x-signature"] || "";
  const expected = signPayload(req.body || {}, config.callbackSecret);
  return { ok: signature === expected, expected, received: signature };
}

function normalizeEvent(payload = {}) {
  const status = String(payload.status || payload.payment_status || payload.event || "").toLowerCase();
  const paid = ["paid", "success", "settlement", "completed", "payment.paid"].includes(status);
  const failed = ["failed", "expired", "cancelled", "canceled", "payment.failed"].includes(status);
  return {
    event_type: paid ? "invoice.paid" : failed ? "invoice.failed" : "invoice.updated",
    status: paid ? "paid" : failed ? "failed" : "pending",
    gateway_reference: payload.gateway_reference || payload.reference || payload.invoice_id || "",
    invoice_id: payload.invoice_id || payload.metadata?.invoice_id || null,
    raw: payload
  };
}

module.exports = { gatewayConfig, createInvoice, verifyCallback, normalizeEvent };

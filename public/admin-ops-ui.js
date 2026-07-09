(() => {
  const MONEY = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
  const state = { open: false, merchants: [], metrics: null, selected: null, detail: null, loading: false, error: "" };

  async function api(url, options = {}) {
    const res = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...options });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function safe(value, fallback = "-") { return value === null || value === undefined || value === "" ? fallback : String(value); }
  function date(value) { return value ? new Date(value).toLocaleString("id-ID") : "-"; }

  async function isSuperadmin() {
    const me = await api("/api/auth/me").catch(() => null);
    return Boolean(me?.authenticated && me.role === "superadmin");
  }

  function ensureButton() {
    const aside = document.querySelector("aside");
    if (!aside || aside.querySelector("[data-admin-ops-button]")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-admin-ops-button", "1");
    btn.innerHTML = '<span style="width:16px;text-align:center;flex-shrink:0;display:inline-block">👑</span> Superadmin';
    btn.addEventListener("click", openPanel);
    aside.appendChild(btn);
  }

  function ensureMobileButton() {
    const menu = document.querySelector(".mobileDropMenu");
    if (!menu || menu.querySelector("[data-admin-ops-button]")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-admin-ops-button", "1");
    btn.innerHTML = '<span style="width:16px;text-align:center;flex-shrink:0;display:inline-block">👑</span> Superadmin';
    btn.addEventListener("click", openPanel);
    menu.appendChild(btn);
  }

  async function load() {
    state.loading = true;
    state.error = "";
    render();
    try {
      const [merchants, metrics] = await Promise.all([api("/api/admin/merchants"), api("/api/admin/metrics")]);
      state.merchants = merchants.merchants || [];
      state.metrics = metrics;
    } catch (err) { state.error = err.message || "Failed to load admin data."; }
    finally { state.loading = false; render(); }
  }

  async function loadDetail(id) {
    state.selected = id;
    state.detail = null;
    render();
    try { state.detail = await api(`/api/admin/merchants/${encodeURIComponent(id)}`); }
    catch (err) { state.error = err.message || "Failed to load merchant."; }
    render();
  }

  async function changePlan(id, plan) {
    if (!confirm(`Change merchant plan to ${plan}?`)) return;
    await api(`/api/admin/merchants/${encodeURIComponent(id)}/change-plan`, { method: "POST", body: JSON.stringify({ plan }) });
    await load();
    await loadDetail(id);
  }

  async function toggleSuspend(merchant) {
    const next = !merchant.suspended;
    if (!confirm(`${next ? "Suspend" : "Unsuspend"} ${merchant.email}?`)) return;
    await api(`/api/admin/merchants/${encodeURIComponent(merchant.id)}`, { method: "PATCH", body: JSON.stringify({ suspended: next }) });
    await load();
    if (state.selected === merchant.id) await loadDetail(merchant.id);
  }

  async function sendReset(merchant) {
    if (!confirm(`Send password reset email to ${merchant.email}?`)) return;
    const result = await api(`/api/admin/merchants/${encodeURIComponent(merchant.id)}/send-reset`, { method: "POST" });
    alert(result.emailSent ? "Password reset email sent." : "Reset token created, but email delivery is not configured or failed.");
  }

  async function confirmInvoice(invoiceId) {
    if (!confirm("Manually confirm this invoice as paid?")) return;
    await api(`/api/admin/invoices/${encodeURIComponent(invoiceId)}/confirm`, { method: "POST" });
    await load();
    if (state.selected) await loadDetail(state.selected);
  }

  function openCsv(path) {
    window.open(path, "_blank", "noopener,noreferrer");
  }

  function openPanel() {
    state.open = true;
    ensureShell();
    load();
  }

  function closePanel() {
    state.open = false;
    document.querySelector(".adminOpsShell")?.remove();
  }

  function ensureShell() {
    if (document.querySelector(".adminOpsShell")) return;
    const shell = document.createElement("div");
    shell.className = "adminOpsShell";
    shell.innerHTML = '<div class="adminOpsBackdrop"></div><section class="adminOpsPanel"></section>';
    shell.querySelector(".adminOpsBackdrop").addEventListener("click", closePanel);
    document.body.appendChild(shell);
  }

  function metricCards() {
    const overview = state.metrics?.overview || {};
    const invoices = state.metrics?.invoices || [];
    const paid = invoices.find((x) => x.status === "paid")?.amount_idr || 0;
    const pending = invoices.find((x) => x.status === "pending")?.amount_idr || 0;
    return `
      <div class="adminMetricGrid">
        <div><b>${overview.merchants || 0}</b><span>Merchants</span></div>
        <div><b>${overview.suspended || 0}</b><span>Suspended</span></div>
        <div><b>${MONEY.format(paid)}</b><span>Paid invoices</span></div>
        <div><b>${MONEY.format(pending)}</b><span>Pending invoices</span></div>
      </div>
    `;
  }

  function merchantRow(m) {
    const active = state.selected === m.id ? " active" : "";
    const usage = m.usage || {};
    return `
      <button class="adminMerchantRow${active}" data-merchant="${m.id}" type="button">
        <div><b>${safe(m.email)}</b><span>${safe(m.name)} · ${safe(m.role)}</span></div>
        <div><em>${safe(m.plan).toUpperCase()}</em><span>${usage.domains || 0} domains · ${usage.nodes || 0} nodes · ${usage.rank_groups || 0} rank</span></div>
        <strong class="${m.suspended ? "danger" : "ok"}">${m.suspended ? "Suspended" : "Active"}</strong>
      </button>
    `;
  }

  function invoiceBlock(invoice) {
    return `
      <div class="adminInvoiceRow">
        <div><b>${safe(invoice.plan).toUpperCase()}</b><span>${MONEY.format(invoice.amount_idr || 0)} · ${date(invoice.created_at)}</span></div>
        <em class="invoiceStatus ${safe(invoice.status)}">${safe(invoice.status)}</em>
        ${invoice.status === "pending" ? `<button type="button" data-confirm-invoice="${invoice.id}">Confirm paid</button>` : ""}
      </div>
    `;
  }

  function detailHtml() {
    if (!state.selected) return '<div class="adminEmpty">Select a merchant to inspect invoices and billing actions.</div>';
    if (!state.detail) return '<div class="adminEmpty">Loading merchant detail...</div>';
    const merchant = state.detail.merchant;
    const invoices = state.detail.invoices || [];
    const usage = merchant.usage || {};
    const limits = merchant.limits || {};
    return `
      <div class="adminDetailHead">
        <div><h3>${safe(merchant.email)}</h3><p>${safe(merchant.name)} · ${safe(merchant.role)} · ${merchant.suspended ? "Suspended" : "Active"}</p></div>
        <button type="button" data-suspend="${merchant.id}">${merchant.suspended ? "Unsuspend" : "Suspend"}</button>
      </div>
      <div class="adminUsageGrid">
        <div><b>${usage.domains || 0}/${limits.max_domains ?? "∞"}</b><span>Domains</span></div>
        <div><b>${usage.projects || 0}/${limits.max_projects ?? "∞"}</b><span>Projects</span></div>
        <div><b>${usage.nodes || 0}/${limits.max_nodes ?? "∞"}</b><span>Nodes</span></div>
        <div><b>${usage.rank_groups || 0}/${limits.max_rank_groups ?? "∞"}</b><span>Rank Groups</span></div>
      </div>
      <div class="adminPlanActions">
        <button type="button" data-plan="free">Set Free</button>
        <button type="button" data-plan="starter">Set Starter</button>
        <button type="button" data-plan="pro">Set Pro</button>
        <button type="button" data-send-reset="${merchant.id}">Send Reset</button>
      </div>
      <h3>Invoices</h3>
      <div class="adminInvoiceList">${invoices.length ? invoices.map(invoiceBlock).join("") : '<p class="adminMuted">No invoices yet.</p>'}</div>
    `;
  }

  function render() {
    ensureShell();
    const panel = document.querySelector(".adminOpsPanel");
    if (!panel) return;
    panel.innerHTML = `
      <button class="adminOpsClose" type="button">×</button>
      <div class="adminOpsHead">
        <div><p class="adminEyebrow">Platform cockpit</p><h2>Superadmin Billing Ops</h2></div>
        <div class="adminTopActions">
          <button type="button" data-export-merchants>Export Merchants</button>
          <button type="button" data-export-invoices>Export Invoices</button>
          <button type="button" data-refresh>Refresh</button>
        </div>
      </div>
      ${state.error ? `<div class="adminError">${state.error}</div>` : ""}
      ${metricCards()}
      <div class="adminOpsGrid">
        <section class="adminMerchantList">
          <h3>Merchants</h3>
          ${state.loading ? '<p class="adminMuted">Loading...</p>' : state.merchants.map(merchantRow).join("") || '<p class="adminMuted">No merchants yet.</p>'}
        </section>
        <section class="adminDetail">${detailHtml()}</section>
      </div>
    `;
    panel.querySelector(".adminOpsClose").addEventListener("click", closePanel);
    panel.querySelector("[data-refresh]").addEventListener("click", load);
    panel.querySelector("[data-export-merchants]").addEventListener("click", () => openCsv("/api/admin/merchants.csv"));
    panel.querySelector("[data-export-invoices]").addEventListener("click", () => openCsv("/api/admin/invoices.csv"));
    panel.querySelectorAll("[data-merchant]").forEach((btn) => btn.addEventListener("click", () => loadDetail(btn.getAttribute("data-merchant"))));
    panel.querySelectorAll("[data-plan]").forEach((btn) => btn.addEventListener("click", () => changePlan(state.selected, btn.getAttribute("data-plan"))));
    panel.querySelectorAll("[data-confirm-invoice]").forEach((btn) => btn.addEventListener("click", () => confirmInvoice(btn.getAttribute("data-confirm-invoice"))));
    panel.querySelectorAll("[data-suspend]").forEach((btn) => {
      const merchant = state.detail?.merchant;
      btn.addEventListener("click", () => merchant && toggleSuspend(merchant));
    });
    panel.querySelectorAll("[data-send-reset]").forEach((btn) => {
      const merchant = state.detail?.merchant;
      btn.addEventListener("click", () => merchant && sendReset(merchant));
    });
  }

  async function boot() {
    if (!(await isSuperadmin())) return;
    ensureButton();
    ensureMobileButton();
  }

  const timer = setInterval(boot, 1000);
  window.addEventListener("focus", boot);
  setTimeout(() => clearInterval(timer), 60000);
})();

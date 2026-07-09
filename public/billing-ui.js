(() => {
  const MONEY = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
  const state = { open: false, loading: false, data: null, usage: null, error: "" };

  async function api(url, options = {}) {
    const res = await fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...options
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const err = new Error(data.error || "Request failed");
      err.data = data;
      throw err;
    }
    return data;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function safe(value, fallback = "-") {
    return value === null || value === undefined || value === "" ? fallback : String(value);
  }

  function pct(current, limit) {
    if (!Number.isFinite(Number(limit)) || Number(limit) <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((Number(current || 0) / Number(limit)) * 100)));
  }

  async function loadUsage() {
    const [overview, projects, nodes, ranks] = await Promise.all([
      api("/api/overview").catch(() => ({})),
      api("/api/projects").catch(() => []),
      api("/api/nodes").catch(() => []),
      api("/api/rank/keywords").catch(() => [])
    ]);
    return {
      domains: Number(overview.total || 0),
      projects: Array.isArray(projects) ? projects.filter((p) => (p.project_name || p.name || "") !== "No Project").length : 0,
      nodes: Array.isArray(nodes) ? nodes.filter((n) => !n.is_platform_node).length : 0,
      rank_groups: Array.isArray(ranks) ? ranks.length : 0
    };
  }

  async function loadBilling() {
    state.loading = true;
    state.error = "";
    renderPanel();
    try {
      const [billing, usage] = await Promise.all([api("/api/billing/me"), loadUsage()]);
      state.data = billing;
      state.usage = usage;
    } catch (err) {
      state.error = err.message || "Failed to load billing.";
    } finally {
      state.loading = false;
      renderPanel();
    }
  }

  function ensureButton() {
    const aside = document.querySelector("aside");
    if (!aside || aside.querySelector("[data-billing-button]")) return;
    const settingsBtn = Array.from(aside.querySelectorAll("button")).find((btn) => /settings/i.test(btn.textContent || ""));
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-billing-button", "1");
    btn.innerHTML = '<span style="width:16px;text-align:center;flex-shrink:0;display:inline-block">💳</span> Billing';
    btn.addEventListener("click", () => openBilling());
    if (settingsBtn?.parentNode) settingsBtn.parentNode.insertBefore(btn, settingsBtn.nextSibling);
    else aside.appendChild(btn);
  }

  function ensureMobileButton() {
    const menu = document.querySelector(".mobileDropMenu");
    if (!menu || menu.querySelector("[data-billing-button]")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-billing-button", "1");
    btn.innerHTML = '<span style="width:16px;text-align:center;flex-shrink:0;display:inline-block">💳</span> Billing';
    btn.addEventListener("click", () => openBilling());
    menu.appendChild(btn);
  }

  function openBilling() {
    state.open = true;
    document.body.classList.add("billingOpen");
    ensureShell();
    loadBilling();
  }

  function closeBilling() {
    state.open = false;
    document.body.classList.remove("billingOpen");
    const shell = document.querySelector(".billingShell");
    if (shell) shell.remove();
  }

  function ensureShell() {
    if (document.querySelector(".billingShell")) return;
    const shell = el("div", "billingShell");
    shell.innerHTML = '<div class="billingBackdrop"></div><section class="billingPanel" aria-live="polite"></section>';
    shell.querySelector(".billingBackdrop").addEventListener("click", closeBilling);
    document.body.appendChild(shell);
  }

  function usageRow(label, current, limit) {
    const percent = pct(current, limit);
    const unlimited = !Number.isFinite(Number(limit)) || Number(limit) >= 999999;
    return `
      <div class="billingUsageRow">
        <div><b>${label}</b><span>${current} / ${unlimited ? "∞" : limit}</span></div>
        <div class="billingBar"><i style="width:${unlimited ? 8 : percent}%"></i></div>
      </div>
    `;
  }

  function invoiceRow(invoice) {
    const status = safe(invoice.status, "pending");
    const amount = MONEY.format(Number(invoice.amount_idr || 0));
    const created = invoice.created_at ? new Date(invoice.created_at).toLocaleString("id-ID") : "-";
    return `
      <div class="billingInvoice">
        <div><b>${safe(invoice.plan).toUpperCase()}</b><span>${amount} · ${created}</span></div>
        <em class="invoiceStatus ${status}">${status}</em>
        ${invoice.payment_url ? `<a href="${invoice.payment_url}" target="_blank" rel="noopener noreferrer">Open payment</a>` : ""}
        ${invoice.payment_instructions ? `<p>${invoice.payment_instructions}</p>` : ""}
      </div>
    `;
  }

  async function createInvoice(planId) {
    state.loading = true;
    state.error = "";
    renderPanel();
    try {
      const result = await api("/api/billing/create-invoice", {
        method: "POST",
        body: JSON.stringify({ plan: planId })
      });
      state.data = null;
      await loadBilling();
      const url = result.invoice?.payment_url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      state.error = err.message || "Failed to create invoice.";
      state.loading = false;
      renderPanel();
    }
  }

  function renderPanel() {
    ensureShell();
    const panel = document.querySelector(".billingPanel");
    if (!panel) return;
    if (state.loading && !state.data) {
      panel.innerHTML = '<button class="billingClose" type="button">×</button><p class="billingEyebrow">Billing</p><h2>Loading plan...</h2><p class="billingMuted">Preparing your subscription cockpit.</p>';
      panel.querySelector(".billingClose").addEventListener("click", closeBilling);
      return;
    }

    const data = state.data || {};
    const plan = data.plan || { id: "free", name: "Free", limits: {} };
    const subscription = data.subscription || { status: "active", plan: plan.id };
    const invoices = Array.isArray(data.invoices) ? data.invoices : [];
    const usage = state.usage || { domains: 0, projects: 0, nodes: 0, rank_groups: 0 };
    const limits = plan.limits || {};
    const currentPeriodEnd = subscription.current_period_end ? new Date(subscription.current_period_end).toLocaleDateString("id-ID") : "-";

    panel.innerHTML = `
      <button class="billingClose" type="button">×</button>
      <div class="billingHead">
        <div>
          <p class="billingEyebrow">Subscription</p>
          <h2>${safe(plan.name, "Free")}</h2>
          <p class="billingMuted">Status: <b>${safe(subscription.status, "active")}</b> · Renewal: ${currentPeriodEnd}</p>
        </div>
        <button class="billingRefresh" type="button">Refresh</button>
      </div>
      ${state.error ? `<div class="billingError">${state.error}</div>` : ""}
      <div class="billingGrid">
        <article>
          <h3>Usage</h3>
          ${usageRow("Domains", usage.domains, limits.max_domains)}
          ${usageRow("Projects", usage.projects, limits.max_projects)}
          ${usageRow("Provider Nodes", usage.nodes, limits.max_nodes)}
          ${usageRow("Rank Groups", usage.rank_groups, limits.max_rank_groups)}
          <p class="billingMuted">Minimum check interval: ${safe(limits.check_interval_min_seconds, 60)} seconds</p>
        </article>
        <article>
          <h3>Upgrade</h3>
          <div class="billingPlanButtons">
            <button type="button" data-plan="starter">Starter · ${MONEY.format(99000)}</button>
            <button type="button" data-plan="pro">Pro · ${MONEY.format(299000)}</button>
          </div>
          <p class="billingMuted">Gateway belum live? Sistem akan membuat invoice manual/mock dulu, jadi aman untuk demo marketing.</p>
        </article>
      </div>
      <article class="billingInvoices">
        <h3>Latest invoices</h3>
        ${invoices.length ? invoices.map(invoiceRow).join("") : '<p class="billingMuted">No invoice yet.</p>'}
      </article>
    `;
    panel.querySelector(".billingClose").addEventListener("click", closeBilling);
    panel.querySelector(".billingRefresh").addEventListener("click", loadBilling);
    panel.querySelectorAll("[data-plan]").forEach((btn) => btn.addEventListener("click", () => createInvoice(btn.getAttribute("data-plan"))));
  }

  function boot() {
    ensureButton();
    ensureMobileButton();
  }

  const timer = setInterval(boot, 700);
  window.addEventListener("focus", boot);
  setTimeout(() => clearInterval(timer), 60000);
})();

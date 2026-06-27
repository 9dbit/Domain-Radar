(() => {
  const PANEL_ID = "domain-radar-ai-advisor-panel";
  let lastSummary = null;
  let lastDomains = [];
  let scanIndex = 0;
  let scanTimer = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeStatus(status) {
    const value = String(status || "unknown").toLowerCase().trim();
    if (["working", "normal", "ok", "online", "success"].includes(value)) return "working";
    if (["warning", "warn", "timeout", "error"].includes(value)) return "warning";
    if (["blocked", "block", "down", "offline"].includes(value)) return "blocked";
    return value || "unknown";
  }

  function statusIcon(status) {
    const value = normalizeStatus(status);
    if (value === "working") return "✅";
    if (value === "warning") return "⚠️";
    if (value === "blocked") return "❗";
    return "•";
  }

  function lineHtml(text) {
    return String(text || "AI Advisor ready. Refresh untuk membaca kondisi terbaru.")
      .split("\n")
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join("");
  }

  function compactList(items, limit = 6) {
    if (!Array.isArray(items) || !items.length) return "-";
    const shown = items.slice(0, limit).join(", ");
    return items.length > limit ? `${shown} +${items.length - limit} more` : shown;
  }

  function makeAnswer(question) {
    const q = String(question || "").toLowerCase();
    const counts = lastSummary?.counts || {};
    const samples = lastSummary?.samples || {};
    const warning = samples.warning || [];
    const blocked = samples.blocked || [];
    const redirected = samples.blocked_redirected || [];
    const totalBlocked = Number(counts.blocked || 0) + Number(counts.blocked_redirected || 0);

    if (!lastSummary) return "AI belum punya snapshot. Klik Refresh AI dulu.";

    if (q.includes("urgent") || q.includes("priority") || q.includes("prioritas")) {
      if (totalBlocked > 0) return `Prioritas utama: ${totalBlocked} blocked domain. Cek BLOCKED dan BLOCKED / REDIRECTED dulu. Sample: ${compactList([...blocked, ...redirected], 8)}.`;
      if (warning.length) return `Prioritas utama: ${warning.length} warning domain. Cek DNS, SSL, redirect, dan provider-node noise. Sample: ${compactList(warning, 8)}.`;
      return "Tidak ada incident urgent. Fokus monitoring dan pastikan node provider tetap valid.";
    }

    if (q.includes("blocked") || q.includes("block")) {
      return `Blocked murni: ${counts.blocked || 0}. Blocked / redirected: ${counts.blocked_redirected || 0}. Blocked: ${compactList(blocked, 8)}. Redirected: ${compactList(redirected, 8)}.`;
    }

    if (q.includes("warning") || q.includes("warn")) {
      return `Warning domain: ${counts.warning || 0}. Sample: ${compactList(warning, 10)}. Action: cek reason history untuk DNS, SSL, redirect, timeout, atau node issue.`;
    }

    if (q.includes("safe") || q.includes("aman") || q.includes("normal")) {
      return `Normal domain: ${counts.normal || 0} dari ${counts.total || 0}. Untuk domain aman detail, gunakan filter NORMAL di tabel utama.`;
    }

    if (q.includes("redirect")) {
      return `Blocked / redirected: ${counts.blocked_redirected || 0}. Sample: ${compactList(redirected, 8)}. Action: audit final URL dan pisahkan dari block registry murni.`;
    }

    return `${lastSummary.summary || "AI summary unavailable."}\n\nTip: coba tanya "urgent today", "blocked analysis", "warning cleanup", "safe domains", atau "redirect audit".`;
  }

  function panelShell() {
    return `
      <button class="aiAdvisorToggle" type="button" data-ai-toggle>✦ AI</button>
      <div class="aiBackdrop" data-ai-backdrop></div>
      <aside id="${PANEL_ID}" class="aiAdvisorSidebar">
        <div class="aiSideHead">
          <div>
            <span class="aiAdvisorSpark">✦</span>
            <b>Domain Radar AI</b>
            <small>Command assistant</small>
          </div>
          <button type="button" data-ai-collapse>×</button>
        </div>

        <div class="aiScannerBox">
          <div class="aiRadar"><i></i><span></span></div>
          <div class="aiScanInfo">
            <b data-scan-title>Scanning whitelisted domains</b>
            <small data-scan-domain>Preparing scanner...</small>
            <div class="aiScanBar"><i data-scan-bar></i></div>
          </div>
        </div>

        <div class="aiMetricMini">
          <span><b data-ai-total>-</b>Total</span>
          <span><b data-ai-warning>-</b>Warn</span>
          <span><b data-ai-blocked>-</b>Block</span>
          <span><b data-ai-redirected>-</b>Redirect</span>
        </div>

        <div class="aiAdvisorText"><p>Loading AI Advisor...</p></div>

        <div class="aiSamples">
          <div><b>Blocked</b><small data-ai-blocked-list>-</small></div>
          <div><b>Blocked / Redirected</b><small data-ai-redirected-list>-</small></div>
        </div>

        <div class="aiPromptChips">
          <button type="button" data-ai-prompt="urgent today">Urgent Today</button>
          <button type="button" data-ai-prompt="blocked analysis">Blocked Analysis</button>
          <button type="button" data-ai-prompt="warning cleanup">Warning Cleanup</button>
          <button type="button" data-ai-prompt="safe domains">Safe Domains</button>
          <button type="button" data-ai-prompt="redirect audit">Redirect Audit</button>
        </div>

        <form class="aiAskBox" data-ai-form>
          <input data-ai-input placeholder="Ask AI about domains..." />
          <button type="submit">Ask</button>
        </form>

        <div class="aiAnswerBox"><b>AI Answer</b><p data-ai-answer>Ask a question or use quick prompts.</p></div>

        <button class="smallBtn aiRefreshFull" type="button" data-ai-refresh>Refresh AI</button>
      </aside>`;
  }

  function mountPanel() {
    if (document.getElementById(PANEL_ID)) return true;
    const main = document.querySelector("main");
    if (!main) return false;
    document.body.insertAdjacentHTML("beforeend", panelShell());

    const panel = document.getElementById(PANEL_ID);
    const toggle = document.querySelector("[data-ai-toggle]");
    const backdrop = document.querySelector("[data-ai-backdrop]");
    const collapse = panel.querySelector("[data-ai-collapse]");
    const refresh = panel.querySelector("[data-ai-refresh]");
    const form = panel.querySelector("[data-ai-form]");

    const closeDrawer = () => document.body.classList.remove("aiSidebarOpen");
    toggle?.addEventListener("click", () => document.body.classList.toggle("aiSidebarOpen"));
    backdrop?.addEventListener("click", closeDrawer);
    collapse?.addEventListener("click", closeDrawer);
    refresh?.addEventListener("click", () => loadAiSummary(true));
    panel.querySelectorAll("[data-ai-prompt]").forEach((btn) => {
      btn.addEventListener("click", () => askAi(btn.getAttribute("data-ai-prompt") || ""));
    });
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = panel.querySelector("[data-ai-input]");
      askAi(input?.value || "");
      if (input) input.value = "";
    });

    loadAiSummary(false);
    return true;
  }

  async function loadAiSummary(manual) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const refresh = panel.querySelector("[data-ai-refresh]");
    if (refresh) refresh.textContent = manual ? "Thinking..." : "Refresh AI";

    try {
      const [summaryRes, domainsRes] = await Promise.all([
        fetch("/api/ai/summary", { credentials: "include" }),
        fetch("/api/domains", { credentials: "include" })
      ]);
      const summary = await summaryRes.json();
      const domains = await domainsRes.json();
      if (!summaryRes.ok) throw new Error(summary.error || "AI summary failed");
      if (!domainsRes.ok) throw new Error(domains.error || "Domain list failed");

      lastSummary = summary;
      lastDomains = Array.isArray(domains) ? domains : [];
      renderSummary(summary);
      startScanner();
    } catch (err) {
      panel.querySelector(".aiAdvisorText").innerHTML = `<p>AI Advisor unavailable: ${escapeHtml(err.message || err)}</p>`;
    } finally {
      if (refresh) refresh.textContent = "Refresh AI";
    }
  }

  function renderSummary(data) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const counts = data.counts || {};
    panel.querySelector("[data-ai-total]").textContent = counts.total ?? "-";
    panel.querySelector("[data-ai-warning]").textContent = counts.warning ?? "-";
    panel.querySelector("[data-ai-blocked]").textContent = counts.blocked ?? "-";
    panel.querySelector("[data-ai-redirected]").textContent = counts.blocked_redirected ?? "-";
    panel.querySelector(".aiAdvisorText").innerHTML = lineHtml(data.summary);
    panel.querySelector("[data-ai-blocked-list]").textContent = compactList(data.samples?.blocked || [], 6);
    panel.querySelector("[data-ai-redirected-list]").textContent = compactList(data.samples?.blocked_redirected || [], 6);
  }

  function startScanner() {
    if (scanTimer) clearInterval(scanTimer);
    scanIndex = 0;
    const domains = lastDomains.length ? lastDomains : [{ domain: "No domain loaded", global_status: "unknown" }];
    scanTimer = setInterval(() => {
      const panel = document.getElementById(PANEL_ID);
      if (!panel) return;
      const item = domains[scanIndex % domains.length];
      const pct = Math.round(((scanIndex % domains.length) + 1) / domains.length * 100);
      panel.querySelector("[data-scan-domain]").textContent = `${statusIcon(item.global_status)} ${item.domain || "unknown"}`;
      panel.querySelector("[data-scan-bar]").style.width = `${pct}%`;
      panel.querySelector("[data-scan-title]").textContent = `Scanning ${domains.length} whitelisted domains`;
      scanIndex += 1;
    }, 950);
  }

  function askAi(question) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const answer = makeAnswer(question);
    panel.querySelector("[data-ai-answer]").innerHTML = escapeHtml(answer).replace(/\n/g, "<br>");
  }

  const timer = setInterval(() => {
    if (mountPanel()) clearInterval(timer);
  }, 500);

  window.addEventListener("focus", () => {
    if (document.getElementById(PANEL_ID)) loadAiSummary(false);
  });
})();

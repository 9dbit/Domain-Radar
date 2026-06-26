(() => {
  const PANEL_ID = "domain-radar-ai-advisor-panel";

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function lineHtml(text) {
    const lines = String(text || "AI Advisor belum punya data. Klik refresh untuk generate summary.").split("\n");
    return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  }

  function sampleHtml(title, items) {
    const text = Array.isArray(items) && items.length ? items.slice(0, 5).join(", ") : "-";
    return `<div><b>${escapeHtml(title)}</b><small>${escapeHtml(text)}</small></div>`;
  }

  function panelShell() {
    return `
      <section id="${PANEL_ID}" class="panel aiAdvisorPanel">
        <div class="panelHead">
          <h2><span class="aiAdvisorSpark">✦</span> Domain Radar AI Advisor</h2>
          <button class="smallBtn" type="button" data-ai-refresh>Refresh AI</button>
        </div>
        <div class="aiAdvisorGrid">
          <div class="aiAdvisorText"><p>Loading AI Advisor...</p></div>
          <div class="aiAdvisorMetrics">
            <span><b>-</b>Total</span>
            <span><b>-</b>Warning</span>
            <span><b>-</b>Blocked</span>
            <span><b>-</b>Redirected</span>
          </div>
        </div>
        <div class="aiSamples">
          ${sampleHtml("Blocked", [])}
          ${sampleHtml("Blocked / Redirected", [])}
        </div>
      </section>`;
  }

  function mountPanel() {
    if (document.getElementById(PANEL_ID)) return true;
    const cards = document.querySelector(".cards");
    if (!cards || !cards.parentNode) return false;
    cards.insertAdjacentHTML("afterend", panelShell());
    const btn = document.querySelector(`#${PANEL_ID} [data-ai-refresh]`);
    if (btn) btn.addEventListener("click", () => loadAiSummary(true));
    loadAiSummary(false);
    return true;
  }

  async function loadAiSummary(manual) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const btn = panel.querySelector("[data-ai-refresh]");
    if (btn) btn.textContent = manual ? "Thinking..." : "Refresh AI";

    try {
      const res = await fetch("/api/ai/summary", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI summary failed");

      const counts = data.counts || {};
      panel.querySelector(".aiAdvisorText").innerHTML = lineHtml(data.summary);
      panel.querySelector(".aiAdvisorMetrics").innerHTML = `
        <span><b>${escapeHtml(counts.total ?? "-")}</b>Total</span>
        <span><b>${escapeHtml(counts.warning ?? "-")}</b>Warning</span>
        <span><b>${escapeHtml(counts.blocked ?? "-")}</b>Blocked</span>
        <span><b>${escapeHtml(counts.blocked_redirected ?? "-")}</b>Redirected</span>`;
      panel.querySelector(".aiSamples").innerHTML =
        sampleHtml("Blocked", data.samples?.blocked || []) +
        sampleHtml("Blocked / Redirected", data.samples?.blocked_redirected || []);
    } catch (err) {
      panel.querySelector(".aiAdvisorText").innerHTML = `<p>AI Advisor unavailable: ${escapeHtml(err.message || err)}</p>`;
    } finally {
      if (btn) btn.textContent = "Refresh AI";
    }
  }

  const timer = setInterval(() => {
    if (mountPanel()) clearInterval(timer);
  }, 500);

  window.addEventListener("focus", () => {
    if (document.getElementById(PANEL_ID)) loadAiSummary(false);
  });
})();

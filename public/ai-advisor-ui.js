(() => {
  const PANEL_ID = "domain-radar-ai-advisor-panel";
  let lastBrief = null;
  let lastProjects = [];
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

  function lineHtml(text) {
    return String(text || "SEO AI ready.")
      .split("\n")
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join("");
  }

  function makeSeoAnswer(question, brief) {
    const q = String(question || "").toLowerCase();
    if (!brief) return "No SEO data loaded. Select a project and click Refresh.";

    const {
      keywords = [], domains = [], redirect_issues = [],
      serp_competitors = [], seo_score = 0, project = ""
    } = brief;

    const workingDomains = domains.filter(d => normalizeStatus(d.global_status) === "working");
    const blockedDomains = domains.filter(d => normalizeStatus(d.global_status) === "blocked");
    const warnDomains = domains.filter(d => normalizeStatus(d.global_status) === "warning");

    const rankedKeywords = keywords
      .map(k => {
        const best = k.domains.filter(d => d.position > 0).sort((a, b) => a.position - b.position)[0];
        return best ? { keyword: k.keyword, ...best } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.position - b.position);

    const avgPos = rankedKeywords.length
      ? Math.round(rankedKeywords.reduce((s, k) => s + k.position, 0) / rankedKeywords.length)
      : null;

    if (q.includes("rank") || q.includes("plan") || q.includes("#1") || q.includes("strategi") || q.includes("strategy")) {
      if (!rankedKeywords.length) {
        return "No ranking data yet for this project. Run a keyword scan first, then I can show which keywords are closest to page 1 and build your rank #1 strategy.";
      }
      const best = rankedKeywords[0];
      const linkPool = workingDomains.slice(0, 5).map(d => d.domain);
      let advice = `🎯 Rank #1 Plan — "${best.keyword}"\n`;
      advice += `• Current position: #${best.position} — Page ${best.page > 0 ? best.page : 1}\n`;
      if (best.page > 1) {
        advice += `• Still on page ${best.page} — needs significant improvement\n`;
      } else if (best.position > 3) {
        advice += `• In top 10! Need ${best.position - 1} more positions to reach #1\n`;
      } else {
        advice += `• Already top 3! Push to #1 with more authority links\n`;
      }
      if (best.matched_url) advice += `• Ranking URL: ${best.matched_url}\n`;
      advice += `\n🔗 Link pool for anchor "${best.keyword}":\n`;
      advice += linkPool.length
        ? linkPool.map(d => `  • ${d}`).join("\n")
        : "  Add healthy domains to project pool first";
      if (redirect_issues.length) advice += `\n\n⚠️ Fix ${redirect_issues.length} redirect issue(s) first — they leak link equity`;
      return advice;
    }

    if (q.includes("link") || q.includes("architect") || q.includes("tier")) {
      let advice = `🔗 Link Architecture — ${project}\n`;
      advice += `\nTier-1 sources (${workingDomains.length} healthy — safe to link):\n`;
      if (workingDomains.length) {
        workingDomains.slice(0, 8).forEach(d => { advice += `  ✅ ${d.domain}\n`; });
      } else {
        advice += "  No healthy domains yet — add domains to this project\n";
      }
      if (warnDomains.length) {
        advice += `\nAudit first (${warnDomains.length} warning — check DNS/SSL):\n`;
        warnDomains.slice(0, 4).forEach(d => { advice += `  ⚠️ ${d.domain}\n`; });
      }
      if (blockedDomains.length) {
        advice += `\nQuarantine — do NOT use for linking (${blockedDomains.length} blocked):\n`;
        blockedDomains.slice(0, 4).forEach(d => { advice += `  🚫 ${d.domain}\n`; });
      }
      if (redirect_issues.length) {
        advice += `\nRemove — canonical mismatch (${redirect_issues.length}):\n`;
        redirect_issues.slice(0, 4).forEach(r => { advice += `  ↩ ${r.domain}\n`; });
      }
      return advice;
    }

    if ((q.includes("redirect") || q.includes("audit")) && !q.includes("canonical")) {
      if (!redirect_issues.length) return "✅ No redirect issues detected. All domains resolve to their correct canonical URLs.";
      let advice = `↩ Redirect Audit — ${redirect_issues.length} issue(s):\n`;
      redirect_issues.slice(0, 8).forEach(r => {
        advice += `  • ${r.domain}\n    → ${r.final_url}\n`;
      });
      advice += "\nAction: Remove from link pool or fix redirect targets to correct canonical URLs.";
      return advice;
    }

    if (q.includes("canonical")) {
      if (!redirect_issues.length) return "✅ No canonical mismatches. All domains resolve to their expected base URLs.";
      let advice = `🔄 Canonical Issues — ${redirect_issues.length} mismatch(es):\n`;
      redirect_issues.slice(0, 6).forEach(r => {
        advice += `  • ${r.domain}\n    Expected: https://${r.domain}\n    Resolves: ${r.final_url}\n`;
      });
      advice += "\nFix: Set canonical tag to correct URL or 301-redirect to proper domain root.";
      return advice;
    }

    if (q.includes("compet") || q.includes("rival") || q.includes("serp")) {
      if (!serp_competitors.length) return "No competitor data yet. Run keyword scans so I can identify which non-whitelisted domains are outranking your link pool.";
      let advice = `🔎 SERP Competition — Threats to your keywords:\n`;
      serp_competitors.slice(0, 6).forEach(c => {
        advice += `  • ${c.host} — appears ${c.appearances}x, best rank #${c.best_position}\n`;
      });
      advice += "\nStrategy: Analyze their backlink profiles and content gaps to find ranking opportunities.";
      return advice;
    }

    if (q.includes("pool") || q.includes("health") || q.includes("domain")) {
      const total = domains.length;
      const tier = seo_score >= 80 ? "STRONG 💪" : seo_score >= 55 ? "WATCH ⚠️" : "RISK 🚨";
      let advice = `💪 Domain Pool — ${tier} (Score: ${seo_score}/100)\n`;
      advice += `  Total domains: ${total}\n`;
      advice += `  Healthy (usable): ${workingDomains.length}`;
      if (total) advice += ` (${Math.round(workingDomains.length / total * 100)}%)`;
      advice += "\n";
      if (warnDomains.length) advice += `  Warning: ${warnDomains.length} — audit DNS/SSL/redirect\n`;
      if (blockedDomains.length) advice += `  Blocked: ${blockedDomains.length} — exclude from linking\n`;
      if (redirect_issues.length) advice += `  Redirect issues: ${redirect_issues.length} — fix canonical\n`;
      const rec = workingDomains.length < 5
        ? "Add more healthy domains to build sufficient link equity for keyword rankings."
        : workingDomains.length / (total || 1) > 0.8
        ? "Pool is in great shape. Use these domains for high-authority internal linking."
        : "Recover warning domains — check each for DNS, SSL, and redirect issues.";
      advice += `\n💡 ${rec}`;
      return advice;
    }

    const kCount = keywords.length;
    let advice = `📊 ${project} — SEO Overview\n`;
    advice += `  ${kCount} keyword${kCount !== 1 ? "s" : ""} tracked`;
    if (avgPos) advice += `, avg position #${avgPos}`;
    advice += `\n  Pool: ${workingDomains.length}/${domains.length} healthy domains`;
    if (redirect_issues.length) advice += `\n  ⚠️ ${redirect_issues.length} redirect issue(s) to fix`;
    if (serp_competitors.length) advice += `\n  🔎 ${serp_competitors.length} competitor domain(s) detected`;
    advice += `\n\nAsk: "Rank #1 Plan", "Link Architecture", "Redirect Audit", "Canonical Issues", "Competition", or "Pool Health"`;
    return advice;
  }

  function panelShell() {
    return `
      <button class="aiAdvisorToggle" type="button" data-ai-toggle>✦ AI</button>
      <div class="aiBackdrop" data-ai-backdrop></div>
      <aside id="${PANEL_ID}" class="aiAdvisorSidebar">

        <div class="aiSideHead">
          <div class="aiSideHeadInner">
            <span class="aiAdvisorSpark">✦</span>
            <div>
              <b>Domain Radar AI</b>
              <small>SEO intelligence advisor</small>
            </div>
          </div>
          <button class="aiCloseBtn" type="button" data-ai-collapse aria-label="Close">✕</button>
        </div>

        <select class="aiProjectSelect" data-ai-project>
          <option value="">Loading projects...</option>
        </select>

        <div class="aiMetricMini">
          <div class="aiMetricCard aiMetricCard--cyan"><b data-ai-keywords>-</b><span>Keywords</span></div>
          <div class="aiMetricCard aiMetricCard--amber"><b data-ai-avgpos>-</b><span>Avg Pos</span></div>
          <div class="aiMetricCard aiMetricCard--emerald"><b data-ai-pool>-</b><span>Pool</span></div>
          <div class="aiMetricCard aiMetricCard--purple"><b data-ai-redirects>-</b><span>Redirs</span></div>
        </div>

        <div class="aiScannerBox">
          <div class="aiRadar"><i></i><span></span></div>
          <div class="aiScanInfo">
            <b data-scan-title>Tracking keywords</b>
            <small data-scan-domain>Loading...</small>
            <div class="aiScanBar"><i data-scan-bar></i></div>
          </div>
        </div>

        <div class="aiPromptChips">
          <button type="button" data-ai-prompt="rank plan">🎯 Rank #1</button>
          <button type="button" data-ai-prompt="link architecture">🔗 Linking</button>
          <button type="button" data-ai-prompt="redirect audit">↩ Redirects</button>
          <button type="button" data-ai-prompt="canonical issues">🔄 Canonical</button>
          <button type="button" data-ai-prompt="competition">🔎 Competition</button>
          <button type="button" data-ai-prompt="pool health">💪 Pool</button>
        </div>

        <div class="aiAnswerBox">
          <div class="aiAnswerLabel">AI Response</div>
          <p data-ai-answer>Ask a question or tap a quick prompt above.</p>
        </div>

        <form class="aiAskBox" data-ai-form>
          <input data-ai-input placeholder="Ask about SEO, keywords, links..." />
          <button type="submit">→</button>
        </form>

        <button class="smallBtn aiRefreshFull" type="button" data-ai-refresh>⟳ Refresh</button>
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
    const projectSelect = panel.querySelector("[data-ai-project]");

    const closeDrawer = () => document.body.classList.remove("aiSidebarOpen");
    toggle?.addEventListener("click", () => document.body.classList.toggle("aiSidebarOpen"));
    backdrop?.addEventListener("click", closeDrawer);
    collapse?.addEventListener("click", closeDrawer);
    refresh?.addEventListener("click", () => {
      const p = panel.querySelector("[data-ai-project]")?.value;
      if (p) loadSeoBrief(p, true); else loadProjects();
    });
    projectSelect?.addEventListener("change", () => {
      const p = projectSelect.value;
      if (p) loadSeoBrief(p, true);
    });
    panel.querySelectorAll("[data-ai-prompt]").forEach((btn) => {
      btn.addEventListener("click", () => askAi(btn.getAttribute("data-ai-prompt") || ""));
    });
    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = panel.querySelector("[data-ai-input]");
      askAi(input?.value || "");
      if (input) input.value = "";
    });

    loadProjects();
    return true;
  }

  async function loadProjects() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    setLoadingState(panel, true);
    const ans = panel.querySelector("[data-ai-answer]");
    if (ans) ans.textContent = "Loading projects…";
    let delegatedToSeoBrief = false;
    try {
      const res = await fetch("/api/ai/seo-brief", { credentials: "include" });
      if (res.status === 401) { setAuthFailState(panel); return; }
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to load projects");
      clearAnswerState(panel);
      lastProjects = data.projects_list || [];
      const select = panel.querySelector("[data-ai-project]");
      if (select) {
        select.innerHTML = lastProjects.length
          ? lastProjects.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("")
          : `<option value="">No projects found</option>`;
      }
      if (lastProjects.length > 0) {
        delegatedToSeoBrief = true;
        loadSeoBrief(lastProjects[0], false);
      } else {
        if (ans) ans.textContent = "No keyword projects found. Add keywords in Rank Defense to start SEO tracking.";
      }
    } catch (err) {
      clearAnswerState(panel);
      if (ans) ans.textContent = `Could not load projects: ${String(err.message || err)}`;
    } finally {
      if (!delegatedToSeoBrief) setLoadingState(panel, false);
    }
  }

  async function loadSeoBrief(projectName, manual) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const refresh = panel.querySelector("[data-ai-refresh]");
    if (refresh) refresh.textContent = manual ? "Thinking..." : "⟳ Refresh";
    setLoadingState(panel, true);
    try {
      const res = await fetch(`/api/ai/seo-brief?project=${encodeURIComponent(projectName)}`, { credentials: "include" });
      if (res.status === 401) { setAuthFailState(panel); return; }
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "SEO brief failed");
      clearAnswerState(panel);
      lastBrief = data;
      renderBrief(data);
      startKeywordTicker();
      const ans = panel.querySelector("[data-ai-answer]");
      if (ans && ans.textContent === "Loading projects…") {
        ans.textContent = "Ask a question or tap a quick prompt above.";
      }
    } catch (err) {
      clearAnswerState(panel);
      const ans = panel.querySelector("[data-ai-answer]");
      if (ans) ans.textContent = `SEO data unavailable: ${String(err.message || err)}`;
    } finally {
      setLoadingState(panel, false);
      if (refresh) refresh.textContent = "⟳ Refresh";
    }
  }

  function renderBrief(brief) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !brief) return;

    const { keywords = [], domains = [], redirect_issues = [], seo_score = 0, project = "" } = brief;
    const working = domains.filter(d => normalizeStatus(d.global_status) === "working");

    panel.querySelector("[data-ai-keywords]").textContent = keywords.length || "-";

    const ranked = keywords.flatMap(k => k.domains.filter(d => d.position > 0));
    const avgPos = ranked.length
      ? Math.round(ranked.reduce((s, d) => s + d.position, 0) / ranked.length)
      : null;
    panel.querySelector("[data-ai-avgpos]").textContent = avgPos ? `#${avgPos}` : "-";
    panel.querySelector("[data-ai-pool]").textContent = domains.length ? `${working.length}/${domains.length}` : "-";
    panel.querySelector("[data-ai-redirects]").textContent = redirect_issues.length;

  }

  function startKeywordTicker() {
    if (scanTimer) clearInterval(scanTimer);
    scanIndex = 0;
    const keywords = lastBrief?.keywords?.length
      ? lastBrief.keywords
      : [{ keyword: "No keywords tracked yet", domains: [] }];

    scanTimer = setInterval(() => {
      const panel = document.getElementById(PANEL_ID);
      if (!panel) return;
      const kw = keywords[scanIndex % keywords.length];
      const best = (kw.domains || []).filter(d => d.position > 0).sort((a, b) => a.position - b.position)[0];
      const posLabel = best ? ` — #${best.position}` : "";
      panel.querySelector("[data-scan-domain]").textContent = `🔑 ${kw.keyword}${posLabel}`;
      panel.querySelector("[data-scan-bar]").style.width =
        `${Math.round(((scanIndex % keywords.length) + 1) / keywords.length * 100)}%`;
      panel.querySelector("[data-scan-title]").textContent =
        `Tracking ${keywords.length} keyword${keywords.length !== 1 ? "s" : ""}`;
      scanIndex += 1;
    }, 1200);
  }

  function setLoadingState(panel, isLoading) {
    if (!panel) return;
    panel.querySelectorAll(".aiMetricCard").forEach(card => {
      card.classList.toggle("aiMetricCard--loading", isLoading);
    });
    panel.querySelectorAll("[data-ai-prompt]").forEach(btn => {
      btn.disabled = isLoading;
    });
    const input = panel.querySelector("[data-ai-input]");
    const submit = panel.querySelector("[data-ai-form] button[type='submit']");
    if (input) input.disabled = isLoading;
    if (submit) submit.disabled = isLoading;
    const answerBox = panel.querySelector(".aiAnswerBox");
    if (answerBox) answerBox.classList.toggle("aiAnswerBox--loading", isLoading);
  }

  function setAuthFailState(panel) {
    if (!panel) return;
    const answerBox = panel.querySelector(".aiAnswerBox");
    if (answerBox) {
      answerBox.classList.remove("aiAnswerBox--loading");
      answerBox.classList.add("aiAnswerBox--authfail");
    }
    const ans = panel.querySelector("[data-ai-answer]");
    if (ans) ans.textContent = "Please log in to use AI Advisor.";
  }

  function clearAnswerState(panel) {
    if (!panel) return;
    const answerBox = panel.querySelector(".aiAnswerBox");
    if (answerBox) {
      answerBox.classList.remove("aiAnswerBox--loading", "aiAnswerBox--authfail");
    }
  }

  function askAi(question) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const answer = makeSeoAnswer(question, lastBrief);
    panel.querySelector("[data-ai-answer]").innerHTML = escapeHtml(answer).replace(/\n/g, "<br>");
  }

  const mountTimer = setInterval(() => {
    if (mountPanel()) clearInterval(mountTimer);
  }, 500);

  window.addEventListener("focus", () => {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const p = panel.querySelector("[data-ai-project]")?.value;
    if (p) loadSeoBrief(p, false);
  });
})();

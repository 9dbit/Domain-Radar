(() => {
  const STORAGE_KEY = "domain_radar_onboarding_dismissed";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function api(url, options = {}) {
    const res = await fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...options
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  async function shouldShow() {
    if (localStorage.getItem(STORAGE_KEY) === "1") return false;
    const me = await api("/api/auth/me").catch(() => null);
    if (!me?.authenticated) return false;
    if (me.role === "superadmin") return false;
    const domains = await api("/api/domains").catch(() => []);
    return Array.isArray(domains) && domains.length === 0;
  }

  function close(root) {
    root.remove();
    localStorage.setItem(STORAGE_KEY, "1");
  }

  function buildOverlay() {
    const root = el("div", "onboardingBackdrop");
    root.innerHTML = `
      <section class="onboardingCard">
        <button class="onboardingClose" type="button" aria-label="Close">×</button>
        <p class="onboardingEyebrow">Merchant onboarding</p>
        <h2>Set up your first radar sweep.</h2>
        <p class="onboardingLead">Create a project, add one domain, optionally save Telegram settings, then your dashboard will start breathing data.</p>
        <div class="onboardingSteps">
          <span class="active">1 Project</span>
          <span>2 Domain</span>
          <span>3 Telegram</span>
          <span>4 Ready</span>
        </div>
        <form class="onboardingForm">
          <label><span>Project name</span><input name="project" placeholder="Empire88 Defense" required /></label>
          <label><span>Domain</span><input name="domain" placeholder="example.com" required /></label>
          <label><span>Telegram Bot Token <small>(optional)</small></span><input name="telegram_bot_token" placeholder="123456:ABC..." /></label>
          <label><span>Telegram Chat ID <small>(optional)</small></span><input name="telegram_chat_id" placeholder="-100xxxxxxxxxx" /></label>
          <div class="onboardingActions">
            <button class="secondary" type="button" data-skip>Skip for now</button>
            <button type="submit">Launch radar</button>
          </div>
          <p class="onboardingMsg" aria-live="polite"></p>
        </form>
      </section>
    `;
    return root;
  }

  async function init() {
    for (let i = 0; i < 20; i += 1) {
      if (document.querySelector(".app") || document.querySelector(".loginPage")) break;
      await sleep(500);
    }
    if (!(await shouldShow())) return;
    const root = buildOverlay();
    document.body.appendChild(root);
    const msg = root.querySelector(".onboardingMsg");
    root.querySelector(".onboardingClose").addEventListener("click", () => close(root));
    root.querySelector("[data-skip]").addEventListener("click", () => close(root));
    root.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const project = String(form.get("project") || "").trim();
      const domain = String(form.get("domain") || "").trim();
      const telegram_bot_token = String(form.get("telegram_bot_token") || "").trim();
      const telegram_chat_id = String(form.get("telegram_chat_id") || "").trim();
      if (!project || !domain) return;
      msg.textContent = "Creating your workspace...";
      try {
        await api("/api/projects", { method: "POST", body: JSON.stringify({ name: project, notes: "Created from onboarding" }) });
        await api("/api/domains", { method: "POST", body: JSON.stringify({ domain, project_name: project }) });
        if (telegram_bot_token || telegram_chat_id) {
          await api("/api/settings", { method: "POST", body: JSON.stringify({ telegram_bot_token, telegram_chat_id }) });
        }
        msg.textContent = "Ready. Reloading dashboard...";
        localStorage.setItem(STORAGE_KEY, "1");
        setTimeout(() => window.location.reload(), 700);
      } catch (err) {
        msg.textContent = err.message || "Onboarding failed.";
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

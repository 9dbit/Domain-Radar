(() => {
  const PAGE_ID = 'settingsAllPage';
  let loaded = false;

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
  }

  async function api(url, opt = {}) {
    const res = await fetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opt });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function isSettingsActive() {
    const active = Array.from(document.querySelectorAll('aside button.navActive'));
    return active.some((b) => /settings/i.test(b.textContent || '')) || Boolean(document.querySelector('main .panelHead h2')?.textContent?.match(/settings/i));
  }

  function pageShell() {
    return `<section id="${PAGE_ID}" class="settingsAllPage panel">
      <div class="settingsAllHero">
        <div><b>Settings</b><p>System, Telegram, Proxy Center, and Provider Nodes in one control page.</p></div>
        <button class="smallBtn" data-refresh-settings>Refresh</button>
      </div>
      <div class="settingsAllGrid">
        <article class="settingsBlock" data-system-block><h3>System</h3><div class="settingsContent">Loading...</div></article>
        <article class="settingsBlock" data-telegram-block><h3>Telegram</h3><div class="settingsContent">Loading...</div></article>
        <article class="settingsBlock" data-proxy-block><h3>Proxy Center</h3><div class="settingsContent">Loading...</div></article>
        <article class="settingsBlock wide" data-node-block><h3>Provider Nodes</h3><div class="settingsContent">Loading...</div></article>
      </div>
    </section>`;
  }

  function hideOriginalSettings() {
    document.querySelectorAll('main > .panel').forEach((panel) => {
      const title = panel.querySelector('.panelHead h2')?.textContent || '';
      if (/settings/i.test(title) && panel.id !== PAGE_ID) panel.style.display = 'none';
    });
  }

  function ensurePage() {
    if (!isSettingsActive()) {
      const page = document.getElementById(PAGE_ID);
      if (page) page.style.display = 'none';
      return;
    }

    hideOriginalSettings();
    const main = document.querySelector('main');
    if (!main) return;
    let page = document.getElementById(PAGE_ID);
    if (!page) {
      main.insertAdjacentHTML('afterbegin', pageShell());
      page = document.getElementById(PAGE_ID);
      page.querySelector('[data-refresh-settings]')?.addEventListener('click', loadSettingsAll);
    }
    page.style.display = 'block';
    if (!loaded) loadSettingsAll();
  }

  function renderSystem(settings) {
    const box = document.querySelector('[data-system-block] .settingsContent');
    if (!box) return;
    box.innerHTML = `<form data-system-form class="settingsAllForm">
      <label><span>Check interval seconds</span><input name="check_interval_seconds" value="${esc(settings.check_interval_seconds || '60')}" /></label>
      <label><span>Retry confirmations</span><input name="retry_confirmations" value="${esc(settings.retry_confirmations || '3')}" /></label>
      <label class="wide"><span>Status keywords</span><input name="status_keywords" value="${esc(settings.status_keywords || '')}" /></label>
      <button>Save System</button>
    </form>`;
    box.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      await api('/api/settings', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd.entries())) });
      loadSettingsAll();
    };
  }

  function renderTelegram(settings) {
    const box = document.querySelector('[data-telegram-block] .settingsContent');
    if (!box) return;
    box.innerHTML = `<form data-telegram-form class="settingsAllForm">
      <label class="wide"><span>Telegram Bot Token</span><input name="telegram_bot_token" value="${esc(settings.telegram_bot_token || '')}" placeholder="123456:ABC..." /></label>
      <label><span>Telegram Chat ID</span><input name="telegram_chat_id" value="${esc(settings.telegram_chat_id || '')}" placeholder="-100xxxx or user id" /></label>
      <button>Save Telegram</button><button type="button" data-test-telegram>Test</button>
    </form>`;
    box.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      await api('/api/settings', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd.entries())) });
      loadSettingsAll();
    };
    box.querySelector('[data-test-telegram]').onclick = async () => {
      await api('/api/telegram/test', { method: 'POST' });
      alert('Telegram test sent.');
    };
  }

  function renderProxy(proxies) {
    const box = document.querySelector('[data-proxy-block] .settingsContent');
    if (!box) return;
    const chips = proxies.map((p) => `<span class="settingsChip"><b>${esc(p.provider_name || '-')}</b> ${esc(p.name || '-')} · ${esc(p.last_health_status || 'unknown')} <button data-del-proxy="${p.id}">×</button></span>`).join('') || '<p class="muted">No proxy configured.</p>';
    box.innerHTML = `<form data-proxy-form class="settingsAllForm">
      <input name="name" placeholder="Name" />
      <input name="provider_name" placeholder="Provider" />
      <input name="proxy_url" placeholder="Proxy URL" />
      <select name="proxy_type"><option value="http">HTTP/HTTPS</option><option value="socks">SOCKS</option></select>
      <button>Add Proxy</button>
    </form><div class="settingsChips">${chips}</div>`;
    box.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.currentTarget).entries());
      await api('/api/proxies', { method: 'POST', body: JSON.stringify(data) });
      loadSettingsAll();
    };
    box.querySelectorAll('[data-del-proxy]').forEach((btn) => btn.onclick = async () => {
      if (confirm('Delete proxy?')) { await api(`/api/proxies/${btn.dataset.delProxy}`, { method: 'DELETE' }); loadSettingsAll(); }
    });
  }

  function renderNodes(nodes) {
    const box = document.querySelector('[data-node-block] .settingsContent');
    if (!box) return;
    const rows = nodes.map((n) => `<tr><td>${esc(n.name)}</td><td>${esc(n.provider_name)}</td><td>${esc(n.raw_network_type || n.network_type)}</td><td>${esc(n.last_health_status || 'unknown')}</td><td>${n.battery_percent ?? 'n/a'}</td><td>${esc(n.network_label || n.radio_type || n.signal_label || 'n/a')}</td><td><button data-ping-node="${n.id}">Ping</button><button data-toggle-node="${n.id}">Power</button><button data-del-node="${n.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="7">No provider node configured.</td></tr>';
    box.innerHTML = `<p class="hint">Provider Node = real checker di jaringan Telkomsel/XL/Indosat/IndiHome/Biznet lewat device agent.</p>
      <form data-node-form class="settingsAllForm nodeFormAll">
        <input name="name" placeholder="Node name TELKOMSEL-JKT-01" />
        <input name="provider_name" placeholder="Provider Telkomsel" />
        <select name="network_type"><option value="mobile">Mobile</option><option value="broadband">Broadband</option><option value="proxy">Proxy</option><option value="vps">VPS</option></select>
        <input name="endpoint_url" placeholder="Endpoint https://node-url" />
        <input name="secret_key" placeholder="Secret key" />
        <button>Add Node</button>
      </form>
      <div class="settingsTableWrap"><table><thead><tr><th>Name</th><th>Provider</th><th>Type</th><th>Health</th><th>Battery</th><th>Signal</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    box.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.currentTarget).entries());
      await api('/api/nodes', { method: 'POST', body: JSON.stringify(data) });
      loadSettingsAll();
    };
    box.querySelectorAll('[data-ping-node]').forEach((btn) => btn.onclick = async () => { await api(`/api/nodes/${btn.dataset.pingNode}/ping`, { method: 'POST' }); loadSettingsAll(); });
    box.querySelectorAll('[data-toggle-node]').forEach((btn) => btn.onclick = async () => { await api(`/api/nodes/${btn.dataset.toggleNode}`, { method: 'PATCH', body: JSON.stringify({}) }); loadSettingsAll(); });
    box.querySelectorAll('[data-del-node]').forEach((btn) => btn.onclick = async () => { if (confirm('Delete node?')) { await api(`/api/nodes/${btn.dataset.delNode}`, { method: 'DELETE' }); loadSettingsAll(); } });
  }

  async function loadSettingsAll() {
    const page = document.getElementById(PAGE_ID);
    if (!page) return;
    try {
      const [settings, proxies, nodes] = await Promise.all([api('/api/settings'), api('/api/proxies'), api('/api/nodes')]);
      renderSystem(settings || {});
      renderTelegram(settings || {});
      renderProxy(Array.isArray(proxies) ? proxies : []);
      renderNodes(Array.isArray(nodes) ? nodes : []);
      loaded = true;
    } catch (err) {
      page.querySelector('.settingsAllGrid').innerHTML = `<div class="errorBox">${esc(err.message)}</div>`;
    }
  }

  setInterval(ensurePage, 500);
  window.addEventListener('focus', () => { loaded = false; ensurePage(); });
})();

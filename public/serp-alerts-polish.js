(() => {
  const PANEL_ID = 'serpAlertPanel';
  const STORAGE_KEY = 'domainRadarSerpAlertCollapsed';

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
  }

  function isDefensePage() {
    return location.pathname.includes('rank-defense') || location.hash === '#defense' || Boolean(document.querySelector('.defensePage')) || document.body.textContent.includes('Rank Defense Center');
  }

  function hideOldExpandedPanel() {
    const nodes = Array.from(document.querySelectorAll('section, article, div')).filter((el) => {
      if (el.id === PANEL_ID || el.closest('#' + PANEL_ID)) return false;
      const text = (el.textContent || '').trim();
      return text.includes('Phishing alerts') && text.includes('DOMAIN') && text.includes('POSITION');
    });
    nodes.slice(0, 2).forEach((el) => { el.style.display = 'none'; });
  }

  async function getJson(url) {
    const res = await fetch(url, { credentials: 'include' });
    const data = await res.json().catch(() => ([]));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function renderRows(items) {
    if (!items.length) return '<div class="serpEmpty">No urgent SERP alerts right now.</div>';
    const rows = items.slice(0, 50).map((r) => {
      const domain = r.domain || r.host || '-';
      const keyword = r.keyword || '-';
      const pos = r.position ? '#' + r.position : '-';
      const url = r.matched_url || r.link || '#';
      return '<tr>' +
        '<td class="serpDomain">' + esc(domain) + '</td>' +
        '<td class="serpKeyword">' + esc(keyword) + '</td>' +
        '<td class="serpRank">' + esc(pos) + '</td>' +
        '<td><button class="serpGoBtn" data-serp-url="' + esc(url) + '">Open</button></td>' +
      '</tr>';
    }).join('');
    return '<div class="serpTableWrap"><table class="serpAlertTable"><thead><tr><th>Domain</th><th>Keyword</th><th>Position</th><th>Action</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function renderPanel(items) {
    let panel = document.getElementById(PANEL_ID);
    const main = document.querySelector('main') || document.querySelector('.contentMain');
    if (!main) return;
    if (!panel) {
      panel = document.createElement('section');
      panel.id = PANEL_ID;
      main.prepend(panel);
    }

    const collapsed = localStorage.getItem(STORAGE_KEY) !== '0';
    panel.className = 'serpAlertPanel' + (collapsed ? ' isCollapsed' : '');
    const count = items.length;
    const top = items.slice(0, 3).map((r) => '<span class="serpChip"><strong>' + esc(r.domain || r.host || '-') + '</strong><em>#' + esc(r.position || '-') + '</em></span>').join('');
    panel.innerHTML = '<div class="serpAlertHead">' +
      '<div class="serpAlertTitle"><span class="serpAlertIcon">⚠️</span><div><b>Phishing alerts (' + count + ')</b><span>' + (count ? 'Top suspicious Google results found. Expand to review and report.' : 'No urgent suspicious SERP result right now.') + '</span></div></div>' +
      '<div class="serpAlertActions"><button type="button" data-serp-refresh>Refresh</button><button type="button" class="primary" data-serp-toggle>' + (collapsed ? 'Expand' : 'Collapse') + '</button></div>' +
    '</div>' +
    (collapsed ? '<div class="serpAlertBody"><div class="serpAlertSummary">' + (top || '<span class="serpChip"><strong>Clear</strong><em>0</em></span>') + '</div></div>' : '<div class="serpAlertBody">' + renderRows(items) + '</div>');

    panel.querySelector('[data-serp-toggle]').onclick = () => {
      localStorage.setItem(STORAGE_KEY, collapsed ? '0' : '1');
      renderPanel(items);
    };
    panel.querySelector('[data-serp-refresh]').onclick = load;
    panel.querySelectorAll('[data-serp-url]').forEach((btn) => {
      btn.onclick = () => {
        const url = btn.getAttribute('data-serp-url');
        if (url && url !== '#') window.open(url, '_blank', 'noopener');
      };
    });
  }

  async function load() {
    if (!isDefensePage()) return;
    hideOldExpandedPanel();
    try {
      const results = await getJson('/api/rank/results');
      const items = Array.isArray(results) ? results.filter((r) => r.classification === 'suspicious').sort((a, b) => Number(a.position || 999) - Number(b.position || 999)) : [];
      renderPanel(items);
    } catch (err) {
      renderPanel([]);
    }
  }

  window.addEventListener('hashchange', () => setTimeout(load, 150));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
  setTimeout(load, 900);
})();

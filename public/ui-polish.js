(() => {
  function card(title, body) {
    return '<article class="analyticsCard"><h3>' + title + '</h3><div>' + body + '</div></article>';
  }

  function html(value) {
    return String(value ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  }

  function friendlyAiError(err) {
    const raw = String(err?.message || err || '').toLowerCase();
    if (raw.includes('quota') || raw.includes('insufficient_quota') || raw.includes('rate limit') || raw.includes('429') || raw.includes('billing')) {
      return 'iam bussy right now, currently learn something about your company, please try again in 15-30 minutes';
    }
    return err?.message || 'Analytics unavailable';
  }

  function lines(text) {
    return String(text || '-').split('\n').map((x) => '<p>' + html(x) + '</p>').join('');
  }

  function list(items) {
    if (!Array.isArray(items) || !items.length) return '-';
    return html(items.slice(0, 18).join(', ') + (items.length > 18 ? ' +' + (items.length - 18) + ' more' : ''));
  }

  function radioGenerationLabel(value) {
    const raw = String(value || '').toLowerCase().trim();
    if (!raw) return '';
    if (raw.includes('nr') || raw.includes('5g')) return '5G';
    if (raw.includes('lte') || raw.includes('4g')) return '4G LTE';
    if (raw.includes('hspa') || raw.includes('hsdpa') || raw.includes('hsupa')) return '3G HSPA';
    if (raw.includes('umts') || raw.includes('wcdma') || raw.includes('3g')) return '3G';
    if (raw.includes('edge')) return 'EDGE';
    if (raw.includes('gprs')) return 'GPRS';
    if (raw.includes('gsm') || raw.includes('2g')) return '2G GSM';
    if (raw.includes('cdma') || raw.includes('evdo')) return 'CDMA';
    return String(value || '').toUpperCase();
  }

  function signalDetailLabel(node) {
    const parts = [];
    if (node.signal_label) parts.push(node.signal_label);
    if (node.signal_dbm !== null && node.signal_dbm !== undefined) parts.push(node.signal_dbm + ' dBm');
    if (node.signal_asu !== null && node.signal_asu !== undefined) parts.push(node.signal_asu + ' ASU');
    if (node.network_type_label) parts.push(String(node.network_type_label).toUpperCase());
    return parts.length ? parts.join(' / ') : 'n/a';
  }

  function nodeGenerationLabel(node) {
    return radioGenerationLabel(node.network_type_label || node.radio_type || node.network_label || node.raw_network_type || '');
  }

  function quotaText(node) {
    if (!node) return '';
    const label = String(node.quota_label || '').trim();
    if (label && label !== 'n/a') return label;
    const r = Number(node.quota_remaining_gb);
    const t = Number(node.quota_total_gb);
    if (Number.isFinite(r) && Number.isFinite(t)) return r + ' GB / ' + t + ' GB';
    if (Number.isFinite(r)) return r + ' GB';
    return '';
  }

  function quotaClass(node) {
    const status = String(node.quota_status || '').toLowerCase();
    if (status) return status;
    const r = Number(node.quota_remaining_gb);
    const t = Number(node.quota_total_gb);
    if (!Number.isFinite(r)) return 'unknown';
    if (r <= 1) return 'critical';
    if (r <= 3) return 'warning';
    if (Number.isFinite(t) && t > 0 && r / t <= 0.1) return 'warning';
    return 'good';
  }

  function ensureQuotaStyle() {
    if (document.getElementById('providerQuotaStyle')) return;
    const style = document.createElement('style');
    style.id = 'providerQuotaStyle';
    style.textContent = '.nodeQuotaLine{margin-top:8px;font-size:12px;font-weight:800;letter-spacing:.02em;display:flex;gap:6px;align-items:center}.nodeQuotaLine.good{color:#20e070}.nodeQuotaLine.warning{color:#f7c948}.nodeQuotaLine.critical{color:#ff4d5e}.nodeQuotaLine.unknown{color:#8b95a7}.nodeQuotaLine small{font-weight:600;color:#8b95a7}';
    document.head.appendChild(style);
  }

  function ensurePage() {
    const main = document.querySelector('main');
    if (!main) return null;
    let page = document.getElementById('analyticsPage');
    if (page) return page;
    page = document.createElement('section');
    page.id = 'analyticsPage';
    page.className = 'analyticsPage';
    page.innerHTML = '<div class="analyticsHero"><div><b>✦ Analytics</b><p>Risk intelligence, reason grouping, and domain action plan.</p></div><button class="smallBtn" data-refresh-analytics>Refresh</button></div><div class="analyticsGridTop"><div><b data-total>-</b><span>Total</span></div><div><b data-normal>-</b><span>Normal</span></div><div><b data-warning>-</b><span>Warning</span></div><div><b data-blocked>-</b><span>Blocked</span></div></div><div class="analyticsBody"></div>';
    main.prepend(page);
    page.querySelector('[data-refresh-analytics]').onclick = loadAnalytics;
    return page;
  }

  async function getJson(url) {
    const res = await fetch(url, { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || url + ' ' + res.status);
    return data;
  }

  function setNativeValue(input, value) {
    if (!input) return;
    const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function collectProjectNames(projects, domains) {
    const names = new Set();
    (projects || []).forEach((p) => { const name = String(p.project_name || p.name || '').trim(); if (name && name !== 'No Project') names.add(name); });
    (domains || []).forEach((d) => { const name = String(d.project_name || '').trim(); if (name && name !== 'No Project') names.add(name); });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  function buildProjectSelect(names, targetInput, placeholder) {
    const select = document.createElement('select');
    select.className = 'projectModeSelect';
    select.innerHTML = '<option value="__new__">+ Project baru</option>' + names.map((name) => '<option value="' + html(name) + '">' + html(name) + '</option>').join('');
    select.title = placeholder || 'Pilih project existing atau buat project baru';
    select.onchange = () => {
      if (select.value === '__new__') {
        setNativeValue(targetInput, '');
        targetInput.placeholder = placeholder || 'Project baru';
        targetInput.readOnly = false;
        targetInput.style.display = '';
        targetInput.focus();
      } else {
        setNativeValue(targetInput, select.value);
        targetInput.placeholder = 'Project existing selected';
        targetInput.readOnly = true;
        targetInput.style.display = '';
      }
    };
    return select;
  }

  async function patchProjectSelectors() {
    try {
      const [projects, domains] = await Promise.all([getJson('/api/projects'), getJson('/api/domains')]);
      const names = collectProjectNames(projects, domains);
      if (!names.length) return;
      const createInput = document.querySelector('.createProjectForm input[placeholder^="Project name"]');
      if (createInput && !createInput.dataset.projectSelectPatched) {
        createInput.dataset.projectSelectPatched = '1';
        createInput.parentNode.insertBefore(buildProjectSelect(names, createInput, 'Project baru, contoh: Empire88'), createInput);
      }
      const rankInput = document.querySelector('.rankForm input[placeholder="Project name"]');
      if (rankInput && !rankInput.dataset.projectSelectPatched) {
        rankInput.dataset.projectSelectPatched = '1';
        rankInput.parentNode.insertBefore(buildProjectSelect(names, rankInput, 'Project baru untuk Google Rank'), rankInput);
      }
    } catch (_) {}
  }

  async function loadAnalytics() {
    const page = ensurePage();
    if (!page) return;
    try {
      const [summary, domains, results] = await Promise.all([getJson('/api/ai/summary'), getJson('/api/domains'), getJson('/api/results')]);
      const counts = summary.counts || {};
      const warning = domains.filter((d) => d.global_status === 'warning').map((d) => d.domain);
      const blocked = domains.filter((d) => d.global_status === 'blocked').map((d) => d.domain);
      const reason = results.reduce((a, r) => { const k = r.reason_type || 'UNKNOWN'; a[k] = (a[k] || 0) + 1; return a; }, {});
      const reasonHtml = Object.entries(reason).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v]) => '<p><b>' + html(k) + ':</b> ' + v + '</p>').join('');
      page.querySelector('[data-total]').textContent = counts.total ?? domains.length;
      page.querySelector('[data-normal]').textContent = counts.normal ?? 0;
      page.querySelector('[data-warning]').textContent = counts.warning ?? warning.length;
      page.querySelector('[data-blocked]').textContent = Number(counts.blocked || 0) + Number(counts.blocked_redirected || 0);
      page.querySelector('.analyticsBody').innerHTML = '<div class="analyticsTwoCol">' + card('AI Executive Summary', lines(summary.summary)) + card('Recommended Action', '<p>Handle blocked domains first.</p><p>Separate pure blocked and redirected blocked domains.</p><p>Review warning domains by DNS, SSL, HTTP, redirect, and node status.</p>') + '</div><div class="analyticsTwoCol">' + card('Risk Buckets', '<p><b>Critical:</b> ' + list(blocked) + '</p><p><b>Watch:</b> ' + list(warning) + '</p><p><b>Stable:</b> ' + html(counts.normal ?? 0) + ' normal domains.</p>') + card('Reason Intelligence', reasonHtml || '-') + '</div><article class="analyticsCard analyticsWide"><h3>Domain Samples</h3><div class="analyticsSamples"><div><b>Warning</b><span>' + list(warning) + '</span></div><div><b>Blocked</b><span>' + list(blocked) + '</span></div><div><b>Blocked / Redirected</b><span>' + list(summary.samples?.blocked_redirected || []) + '</span></div></div></article>';
    } catch (err) {
      page.querySelector('.analyticsBody').innerHTML = '<article class="analyticsCard"><h3>Analytics unavailable</h3><p>' + html(friendlyAiError(err)) + '</p></article>';
    }
  }

  async function patchProviderSignalLabels() {
    try {
      ensureQuotaStyle();
      const nodes = await getJson('/api/nodes');
      if (!Array.isArray(nodes)) return;
      const byName = new Map(nodes.map((node) => [String(node.name || '').trim(), node]));
      document.querySelectorAll('.nodeStatusCard').forEach((cardEl) => {
        const name = cardEl.querySelector('.nodeTitleBlock b')?.textContent?.trim();
        const node = byName.get(name);
        if (!node) return;
        const generation = nodeGenerationLabel(node);
        const labelEl = cardEl.querySelector('.signalGauge b');
        if (labelEl && generation) labelEl.textContent = generation;
        const gaugeEl = cardEl.querySelector('.signalGauge');
        if (gaugeEl && generation) gaugeEl.title = 'Signal ' + generation + ' · ' + signalDetailLabel(node);
        const q = quotaText(node);
        let qEl = cardEl.querySelector('.nodeQuotaLine');
        if (q) {
          if (!qEl) {
            qEl = document.createElement('div');
            qEl.className = 'nodeQuotaLine';
            const meta = cardEl.querySelector('.nodeMetaLine') || cardEl.querySelector('.nodeTelemetryRow') || cardEl;
            meta.parentNode.insertBefore(qEl, meta.nextSibling);
          }
          qEl.className = 'nodeQuotaLine ' + quotaClass(node);
          qEl.innerHTML = 'Quota: ' + html(q) + (node.quota_expires_at ? ' <small>exp ' + html(node.quota_expires_at) + '</small>' : '');
        } else if (qEl) {
          qEl.remove();
        }
      });
      document.querySelectorAll('table tbody tr').forEach((row) => {
        const firstCell = row.querySelector('td');
        const name = firstCell?.textContent?.trim();
        const node = byName.get(name);
        if (!node) return;
        const generation = nodeGenerationLabel(node);
        const cells = row.querySelectorAll('td');
        if (generation && cells.length >= 7 && row.textContent.includes(node.provider_name || '')) {
          cells[6].innerHTML = html(generation) + (node.signal_dbm !== null && node.signal_dbm !== undefined ? ' <span class="muted">' + html(node.signal_dbm + ' dBm') + '</span>' : '');
        }
      });
    } catch (_) {}
  }

  function ensureCompactRankPanel() {
    const main = document.querySelector('main');
    if (!main) return;
    if (!document.body.textContent.includes('Rank Defense Center')) return;
    if (document.getElementById('rankCompactAlertPanel')) return;
    fetch('/api/rank/results', { credentials: 'include' }).then((r) => r.json()).then((rows) => {
      const items = Array.isArray(rows) ? rows.filter((x) => x.classification === 'suspicious').sort((a,b) => Number(a.position || 999) - Number(b.position || 999)) : [];
      const panel = document.createElement('section');
      panel.id = 'rankCompactAlertPanel';
      panel.className = 'serpAlertPanel isCollapsed';
      const chips = items.slice(0,3).map((x) => '<span class="serpChip"><strong>' + html(x.domain || '-') + '</strong><em>#' + html(x.position || '-') + '</em></span>').join('');
      panel.innerHTML = '<div class="serpAlertHead"><div class="serpAlertTitle"><span class="serpAlertIcon">⚠️</span><div><b>Rank alerts (' + items.length + ')</b><span>Suspicious SERP results are collapsed for cleaner review.</span></div></div><div class="serpAlertActions"><button type="button" data-rank-toggle>Expand</button></div></div><div class="serpAlertBody"><div class="serpAlertSummary">' + (chips || '<span class="serpChip"><strong>Clear</strong><em>0</em></span>') + '</div></div>';
      main.prepend(panel);
      const button = panel.querySelector('[data-rank-toggle]');
      button.onclick = () => {
        const open = panel.classList.toggle('isOpen');
        panel.classList.toggle('isCollapsed', !open);
        button.textContent = open ? 'Collapse' : 'Expand';
        if (open) {
          const rowsHtml = items.slice(0,50).map((x) => '<tr><td class="serpDomain">' + html(x.domain || '-') + '</td><td>' + html(x.keyword || '-') + '</td><td>#' + html(x.position || '-') + '</td><td><a target="_blank" href="' + html(x.matched_url || '#') + '">Open</a></td></tr>').join('');
          panel.querySelector('.serpAlertBody').innerHTML = '<div class="serpTableWrap"><table class="serpAlertTable"><thead><tr><th>Domain</th><th>Keyword</th><th>Position</th><th>Action</th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
        } else {
          panel.querySelector('.serpAlertBody').innerHTML = '<div class="serpAlertSummary">' + (chips || '<span class="serpChip"><strong>Clear</strong><em>0</em></span>') + '</div>';
        }
      };
    }).catch(() => {});
  }

  window._ensureAnalyticsPage = ensurePage;
  window._loadAnalytics = loadAnalytics;
  window._patchProviderSignalLabels = patchProviderSignalLabels;
  window._patchProjectSelectors = patchProjectSelectors;
  setTimeout(ensureCompactRankPanel, 700);
  setTimeout(patchProviderSignalLabels, 900);
  setTimeout(patchProjectSelectors, 1000);
  setInterval(patchProviderSignalLabels, 4000);
  setInterval(patchProjectSelectors, 5000);
  window.addEventListener('hashchange', () => {
    setTimeout(ensureCompactRankPanel, 300);
    setTimeout(patchProviderSignalLabels, 500);
    setTimeout(patchProjectSelectors, 500);
  });
})();

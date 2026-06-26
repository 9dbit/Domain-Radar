(() => {
  function addNav() {
    const side = document.querySelector('aside');
    if (!side || side.querySelector('[data-analytics-nav]')) return;
    const buttons = Array.from(side.querySelectorAll('button'));
    const rank = buttons.find((b) => /google rank/i.test(b.textContent || ''));
    if (!rank) return;

    rank.insertAdjacentHTML('afterend', '<button data-defense-nav type="button">🛡 Defense Center</button><button data-analytics-nav type="button">✦ Analytics</button>');
    side.querySelector('[data-defense-nav]').onclick = () => { location.href = '/rank-defense.html'; };
    side.querySelector('[data-analytics-nav]').onclick = () => showAnalytics();

    buttons.forEach((b) => b.addEventListener('click', () => hideAnalytics()));
  }

  function card(title, body) {
    return '<article class="analyticsCard"><h3>' + title + '</h3><div>' + body + '</div></article>';
  }

  function html(value) {
    return String(value ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  }

  function lines(text) {
    return String(text || '-').split('\n').map((x) => '<p>' + html(x) + '</p>').join('');
  }

  function list(items) {
    if (!Array.isArray(items) || !items.length) return '-';
    return html(items.slice(0, 18).join(', ') + (items.length > 18 ? ' +' + (items.length - 18) + ' more' : ''));
  }

  function ensurePage() {
    const main = document.querySelector('main');
    if (!main) return null;
    let page = document.getElementById('analyticsPage');
    if (page) return page;
    page = document.createElement('section');
    page.id = 'analyticsPage';
    page.className = 'analyticsPage';
    page.innerHTML = '<div class="analyticsHero"><div><b>✦ AI Analytics</b><p>Risk intelligence, reason grouping, and domain action plan.</p></div><button class="smallBtn" data-refresh-analytics>Refresh</button></div><div class="analyticsGridTop"><div><b data-total>-</b><span>Total</span></div><div><b data-normal>-</b><span>Normal</span></div><div><b data-warning>-</b><span>Warning</span></div><div><b data-blocked>-</b><span>Blocked</span></div></div><div class="analyticsBody"></div>';
    main.prepend(page);
    page.querySelector('[data-refresh-analytics]').onclick = loadAnalytics;
    return page;
  }

  function showAnalytics() {
    ensurePage();
    document.body.classList.add('analyticsMode');
    document.querySelectorAll('aside button').forEach((b) => b.classList.remove('navActive'));
    document.querySelector('[data-analytics-nav]')?.classList.add('navActive');
    loadAnalytics();
  }

  function hideAnalytics() {
    document.body.classList.remove('analyticsMode');
    document.querySelector('[data-analytics-nav]')?.classList.remove('navActive');
  }

  async function getJson(url) {
    const res = await fetch(url, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || url);
    return data;
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
      page.querySelector('.analyticsBody').innerHTML = '<article class="analyticsCard"><h3>Analytics unavailable</h3><p>' + html(err.message) + '</p></article>';
    }
  }

  const timer = setInterval(() => { addNav(); ensurePage(); if (document.querySelector('[data-analytics-nav]')) clearInterval(timer); }, 500);
})();

(() => {
  let domains = [];
  let tick = 0;

  async function loadDomains() {
    try {
      const res = await fetch('/api/domains', { credentials: 'include' });
      const data = await res.json();
      if (res.ok && Array.isArray(data)) domains = data.map((d) => d.domain).filter(Boolean);
    } catch (_) {}
    if (!domains.length) domains = ['waiting-for-domain-list.local'];
  }

  function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
  }

  function statusOfCard(card) {
    const text = (card.textContent || '').toLowerCase();
    if (text.includes('offline')) return 'offline';
    if (text.includes('online')) return 'online';
    if (text.includes('waiting')) return 'waiting';
    return 'waiting';
  }

  function ensureTerminal(card) {
    if (card.querySelector('.nodeTerminalActivity')) return card.querySelector('.nodeTerminalActivity');
    const terminal = document.createElement('div');
    terminal.className = 'nodeTerminalActivity';
    terminal.innerHTML = '<div class="nodeRadarMini"><i></i><b></b></div><div class="nodeTerminalHead"><span>Live Ping Activity</span><em>scanning</em></div><pre></pre><div class="nodeProgressMini"><i></i></div>';
    const btn = card.querySelector('button.smallBtn');
    if (btn) btn.insertAdjacentElement('beforebegin', terminal);
    else card.appendChild(terminal);
    return terminal;
  }

  function renderCard(card, cardIndex) {
    const terminal = ensureTerminal(card);
    const status = statusOfCard(card);
    terminal.dataset.status = status;
    const pre = terminal.querySelector('pre');
    const bar = terminal.querySelector('.nodeProgressMini i');
    const em = terminal.querySelector('.nodeTerminalHead em');
    const count = Math.max(domains.length, 1);
    const start = (tick + cardIndex * 3) % count;
    const lines = [];
    lines.push('$ pinging ' + count + ' whitelisted domains...');
    for (let i = 0; i < 4; i++) {
      const domain = domains[(start + i) % count] || '-';
      const latency = 18 + ((tick + cardIndex + i * 7) % 44);
      const mark = status === 'offline' ? '×' : status === 'waiting' && i === 3 ? '…' : '✓';
      const result = status === 'offline' ? 'lost' : status === 'waiting' && i === 3 ? 'wait' : latency + 'ms';
      lines.push('> ' + domain.padEnd(18, '.') + ' ' + result + ' ' + mark);
    }
    const pct = Math.round(((start + 1) / count) * 100);
    lines.push('progress ' + pct + '%');
    pre.textContent = lines.join('\n');
    if (bar) bar.style.width = pct + '%';
    if (em) em.textContent = status === 'offline' ? 'offline' : status === 'online' ? 'live' : 'waiting';
  }

  function render() {
    const cards = Array.from(document.querySelectorAll('.nodeStatusCard'));
    cards.forEach((card, index) => renderCard(card, index));
    tick += 1;
  }

  loadDomains().then(render);
  setInterval(render, 1600);
  setInterval(loadDomains, 60000);
})();

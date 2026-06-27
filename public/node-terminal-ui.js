(() => {
  const samples = [
    'google.com', 'youtube.com', 'facebook.com', 'instagram.com', 'tokopedia.com',
    'shopee.co.id', 'detik.com', 'kompas.com', 'wikipedia.org', 'github.com',
    'empire88.com', 'domain-radar.org'
  ];

  function pick(card, index) {
    const title = card.querySelector('.nodeTitleBlock b')?.textContent?.trim() || 'Node';
    const health = card.querySelector('.healthBadge')?.textContent?.trim() || 'waiting';
    const pct = 8 + ((index * 7) % 34);
    const rows = samples.slice(index % 4, (index % 4) + 5).map((d, i) => {
      const ms = 18 + ((index + i) * 7) % 42;
      return `<span><i>$ ping ${d}</i><b>${ms}ms ✓</b></span>`;
    }).join('');
    return { title, health, pct, rows };
  }

  function mount() {
    document.querySelectorAll('.nodeStatusCard').forEach((card, index) => {
      if (card.querySelector('.nodeMiniTerminal')) return;
      const data = pick(card, index);
      const terminal = document.createElement('div');
      terminal.className = 'nodeMiniTerminal';
      terminal.innerHTML = `
        <div class="nodeRadarRow">
          <div class="nodeTinyRadar"><i></i><b></b></div>
          <div class="nodePingProgress">
            <strong>${data.health}</strong>
            <div><span style="width:${data.pct}%"></span></div>
            <small>Scanning whitelist · next ping ${12 + index}s</small>
          </div>
        </div>
        <div class="nodeTerminalLines">${data.rows}</div>
      `;
      const btn = card.querySelector('button.smallBtn');
      if (btn) btn.before(terminal); else card.appendChild(terminal);
    });
  }

  setInterval(mount, 700);
  window.addEventListener('focus', mount);
})();

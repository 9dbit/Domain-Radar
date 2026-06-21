import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { RefreshCw, ShieldAlert, CheckCircle, AlertTriangle, Ban, Lock, LogOut, Settings, Send, Download, Trash2, Pencil, Power, Search, Radio, Bell, FolderKanban } from "lucide-react";
import "./style.css";

async function api(url, options = {}) {
  const res = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...options });
  let data = {};
  try { data = await res.json(); } catch (_) { data = {}; }
  if (!res.ok) {
    const error = new Error(data.error || "Request failed");
    error.status = res.status;
    throw error;
  }
  return data;
}

function Badge({ status }) {
  const cls = `badge ${status || "unknown"}`;
  return <span className={cls}>{status || "unknown"}</span>;
}

function Login({ onLogin }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
      await onLogin();
    } catch (_) {
      setError("Password salah atau session tidak valid.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="loginPage">
      <form className="loginCard" onSubmit={submit}>
        <div className="loginIcon"><Lock size={26} /></div>
        <h1>Domain Radar</h1>
        <p>Masuk ke dashboard monitoring.</p>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Admin password" autoFocus />
        {error ? <div className="errorBox">{error}</div> : null}
        <button type="submit" disabled={loading}>{loading ? "Checking..." : "Login"}</button>
      </form>
    </div>
  );
}

function Dashboard({ onLogout }) {
  const [overview, setOverview] = useState({});
  const [domains, setDomains] = useState([]);
  const [results, setResults] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [projects, setProjects] = useState([]);
  const [domain, setDomain] = useState("");
  const [projectName, setProjectName] = useState("");
  const [bulk, setBulk] = useState("");
  const [proxy, setProxy] = useState({ name: "", provider_name: "", proxy_url: "", proxy_type: "http" });
  const [proxies, setProxies] = useState([]);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [settings, setSettings] = useState({ check_interval_seconds: "60", retry_confirmations: "3", status_keywords: "internetpositif,trustpositif,nawala" });

  async function load() {
    try {
      const [overviewData, domainData, resultData, proxyData, settingsData, alertData, projectData] = await Promise.all([
        api("/api/overview"), api("/api/domains"), api("/api/results"), api("/api/proxies"), api("/api/settings"), api("/api/alerts"), api("/api/projects")
      ]);
      setOverview(overviewData || {});
      setDomains(Array.isArray(domainData) ? domainData : []);
      setResults(Array.isArray(resultData) ? resultData : []);
      setProxies(Array.isArray(proxyData) ? proxyData : []);
      setSettings(settingsData || settings);
      setAlerts(Array.isArray(alertData) ? alertData : []);
      setProjects(Array.isArray(projectData) ? projectData : []);
    } catch (err) {
      if (err.status === 401) onLogout();
      else setNotice(err.message || "Gagal load data.");
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!autoRefresh) return undefined;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [autoRefresh]);

  const projectOptions = useMemo(() => {
    const set = new Set(domains.map((d) => d.project_name || "No Project"));
    return Array.from(set).sort();
  }, [domains]);

  const filteredDomains = useMemo(() => {
    const q = search.trim().toLowerCase();
    return domains.filter((d) => {
      const project = d.project_name || "No Project";
      const matchSearch = !q || d.domain.toLowerCase().includes(q) || project.toLowerCase().includes(q);
      const matchStatus = statusFilter === "all" || d.global_status === statusFilter;
      const matchProject = projectFilter === "all" || project === projectFilter;
      return matchSearch && matchStatus && matchProject;
    });
  }, [domains, search, statusFilter, projectFilter]);

  async function saveSettings(e) {
    e.preventDefault();
    const saved = await api("/api/settings", { method: "POST", body: JSON.stringify(settings) });
    setSettings(saved);
    setNotice("Settings saved permanently to Neon. Retry and keywords apply immediately. Interval applies after restart/redeploy.");
  }

  async function sendTelegramTest() {
    setNotice("Sending Telegram test...");
    const result = await api("/api/telegram/test", { method: "POST" });
    setNotice(result.ok ? "Telegram test sent." : "Telegram test failed. Check bot token and chat id.");
  }

  async function addDomain(e) {
    e.preventDefault();
    await api("/api/domains", { method: "POST", body: JSON.stringify({ domain, project_name: projectName }) });
    setDomain("");
    setProjectName("");
    setNotice("Domain saved.");
    load();
  }

  async function bulkImport() {
    await api("/api/domains/bulk", { method: "POST", body: JSON.stringify({ text: bulk }) });
    setBulk("");
    setNotice("Bulk import selesai. Format support: domain.com, Project Name");
    load();
  }

  async function editDomain(d) {
    const nextDomain = window.prompt("Edit domain", d.domain);
    if (!nextDomain) return;
    const nextProject = window.prompt("Project name", d.project_name || "") ?? d.project_name;
    await api(`/api/domains/${d.id}`, { method: "PATCH", body: JSON.stringify({ domain: nextDomain, project_name: nextProject }) });
    setNotice("Domain updated.");
    load();
  }

  async function toggleDomain(d) {
    await api(`/api/domains/${d.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !d.is_active }) });
    setNotice(d.is_active ? "Domain paused." : "Domain activated.");
    load();
  }

  async function singleCheck(d) {
    setNotice(`Checking ${d.domain}...`);
    await api(`/api/check/domain/${d.id}`, { method: "POST" });
    setNotice(`Single check selesai: ${d.domain}`);
    load();
  }

  async function deleteDomain(d) {
    if (!window.confirm(`Delete ${d.domain}? History check untuk domain ini ikut terhapus.`)) return;
    await api(`/api/domains/${d.id}`, { method: "DELETE" });
    setNotice("Domain deleted.");
    load();
  }

  async function addProxy(e) {
    e.preventDefault();
    await api("/api/proxies", { method: "POST", body: JSON.stringify(proxy) });
    setProxy({ name: "", provider_name: "", proxy_url: "", proxy_type: "http" });
    setNotice("Proxy checker saved.");
    load();
  }

  async function deleteProxy(p) {
    if (!window.confirm(`Delete proxy ${p.name}?`)) return;
    await api(`/api/proxies/${p.id}`, { method: "DELETE" });
    setNotice("Proxy deleted.");
    load();
  }

  async function manualCheck() {
    setNotice("Manual check running...");
    await api("/api/check/manual", { method: "POST" });
    setNotice("Manual check selesai.");
    load();
  }

  function exportCsv(path) { window.open(path, "_blank"); }
  async function logout() { await api("/api/auth/logout", { method: "POST" }); onLogout(); }

  return (
    <div className="app">
      <aside>
        <h1>Domain Radar</h1>
        <p>Multi-checker domain monitor</p>
        <button onClick={manualCheck}><RefreshCw size={16}/> Manual Check All</button>
        <button onClick={sendTelegramTest}><Send size={16}/> Telegram Test</button>
        <button onClick={() => setAutoRefresh(!autoRefresh)}><Radio size={16}/> Auto Refresh: {autoRefresh ? "ON" : "OFF"}</button>
        <button onClick={() => exportCsv("/api/export/domains.csv")}><Download size={16}/> Export Domains</button>
        <button onClick={() => exportCsv("/api/export/results.csv")}><Download size={16}/> Export History</button>
        <button className="ghostBtn" onClick={logout}><LogOut size={16}/> Logout</button>
        {notice ? <p className="sideNotice">{notice}</p> : null}
      </aside>

      <main>
        <section className="cards">
          <div className="card"><ShieldAlert/> <b>{overview.total || 0}</b><span>Total</span></div>
          <div className="card"><CheckCircle/> <b>{overview.working || 0}</b><span>Working</span></div>
          <div className="card"><AlertTriangle/> <b>{overview.warning || 0}</b><span>Warning</span></div>
          <div className="card"><Ban/> <b>{overview.blocked || 0}</b><span>Blocked</span></div>
        </section>

        <section className="panel">
          <div className="panelHead"><h2><FolderKanban size={20}/> Project Summary</h2><button className="smallBtn" onClick={load}><RefreshCw size={15}/> Refresh</button></div>
          <div className="projectGrid">
            {projects.map((p) => (
              <div className="projectCard" key={p.project_name}>
                <b>{p.project_name}</b>
                <span>Total {p.total}</span>
                <small>OK {p.working} · Warning {p.warning} · Blocked {p.blocked}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="panel alertPanel">
          <div className="panelHead"><h2><Bell size={20}/> Alert Center</h2><span className="muted">Latest 100 alerts</span></div>
          <div className="alertList">
            {alerts.length === 0 ? <p className="muted">Belum ada alert.</p> : alerts.slice(0, 8).map((a) => (
              <div className="alertItem" key={a.id}>
                <Badge status={a.new_status}/>
                <div><b>{a.domain || "Deleted domain"}</b><small>{a.old_status} → {a.new_status} · {new Date(a.created_at).toLocaleString()}</small></div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2><Settings size={20}/> Settings</h2>
          <form onSubmit={saveSettings} className="settingsGrid">
            <label><span>Check interval seconds</span><input value={settings.check_interval_seconds} onChange={(e) => setSettings({...settings, check_interval_seconds:e.target.value})} /></label>
            <label><span>Retry confirmations</span><input value={settings.retry_confirmations} onChange={(e) => setSettings({...settings, retry_confirmations:e.target.value})} /></label>
            <label className="wide"><span>Status keywords</span><input value={settings.status_keywords} onChange={(e) => setSettings({...settings, status_keywords:e.target.value})} /></label>
            <button>Save Settings</button>
          </form>
          <p className="hint">Setting tersimpan permanen di Neon. Bulk import support: domain.com, Project Name.</p>
        </section>

        <section className="panel">
          <h2>Add Domain</h2>
          <form onSubmit={addDomain} className="domainForm">
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
            <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Project name optional" />
            <button>Add</button>
          </form>
          <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"Bulk import, one per line\nexample.com, Project A\nexample.net, Project B"} />
          <button onClick={bulkImport}>Bulk Import</button>
        </section>

        <section className="panel">
          <div className="panelHead"><h2>Domains</h2><button className="smallBtn" onClick={() => exportCsv("/api/export/domains.csv")}><Download size={15}/> CSV</button></div>
          <div className="filters">
            <div className="searchBox"><Search size={16}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search domain or project..." /></div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">All status</option><option value="working">Working</option><option value="warning">Warning</option><option value="blocked">Blocked</option><option value="unknown">Unknown</option></select>
            <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}><option value="all">All projects</option>{projectOptions.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          </div>
          <table>
            <thead><tr><th>Domain</th><th>Project</th><th>Status</th><th>Last Status</th><th>Last Checked</th><th>Active</th><th>Actions</th></tr></thead>
            <tbody>
              {filteredDomains.map((d) => (
                <tr key={d.id}>
                  <td className="domainCell">{d.domain}</td><td>{d.project_name || "-"}</td><td><Badge status={d.global_status}/></td><td>{d.last_status || "-"}</td><td>{d.last_checked_at ? new Date(d.last_checked_at).toLocaleString() : "-"}</td><td>{d.is_active ? "Yes" : "No"}</td>
                  <td><div className="actions"><button className="iconBtn" title="Single Check" onClick={() => singleCheck(d)}><RefreshCw size={14}/></button><button className="iconBtn" title="Edit" onClick={() => editDomain(d)}><Pencil size={14}/></button><button className="iconBtn" title="Active/Pause" onClick={() => toggleDomain(d)}><Power size={14}/></button><button className="iconBtn danger" title="Delete" onClick={() => deleteDomain(d)}><Trash2 size={14}/></button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Proxy Checker</h2>
          <form onSubmit={addProxy} className="grid"><input placeholder="Name" value={proxy.name} onChange={(e) => setProxy({...proxy, name:e.target.value})}/><input placeholder="Provider" value={proxy.provider_name} onChange={(e) => setProxy({...proxy, provider_name:e.target.value})}/><input placeholder="Proxy URL" value={proxy.proxy_url} onChange={(e) => setProxy({...proxy, proxy_url:e.target.value})}/><select value={proxy.proxy_type} onChange={(e) => setProxy({...proxy, proxy_type:e.target.value})}><option value="http">HTTP/HTTPS</option><option value="socks">SOCKS</option></select><button>Add Proxy</button></form>
          <div className="chips">{proxies.map((p) => <span key={p.id}>{p.provider_name}: {p.name} · {p.last_health_status || "unknown"}<button className="chipDelete" onClick={() => deleteProxy(p)}>×</button></span>)}</div>
        </section>

        <section className="panel">
          <div className="panelHead"><h2>History</h2><button className="smallBtn" onClick={() => exportCsv("/api/export/results.csv")}><Download size={15}/> CSV</button></div>
          <table><thead><tr><th>Time</th><th>Domain</th><th>Checker</th><th>Status</th><th>HTTP</th><th>Latency</th><th>Reason</th></tr></thead><tbody>{results.map((r) => <tr key={r.id}><td>{new Date(r.checked_at).toLocaleString()}</td><td className="domainCell">{r.domain}</td><td>{r.provider_name}</td><td><Badge status={r.status}/></td><td>{r.http_status || "-"}</td><td>{r.latency_ms ? `${r.latency_ms}ms` : "-"}</td><td>{r.reason}</td></tr>)}</tbody></table>
        </section>
      </main>
    </div>
  );
}

function App() {
  const [checked, setChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [bootError, setBootError] = useState("");
  async function checkAuth() {
    try { const me = await api("/api/auth/me"); setAuthenticated(Boolean(me.authenticated)); }
    catch (err) { setBootError(err.message || "Auth check failed."); setAuthenticated(false); }
    finally { setChecked(true); }
  }
  useEffect(() => { checkAuth(); }, []);
  if (!checked) return <div className="loading">Loading Domain Radar...</div>;
  if (!authenticated) return (<><Login onLogin={async () => { setAuthenticated(true); }} />{bootError ? <div className="bootError">{bootError}</div> : null}</>);
  return <Dashboard onLogout={() => setAuthenticated(false)} />;
}

const rootEl = document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<App />);

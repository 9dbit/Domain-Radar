import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RefreshCw, ShieldAlert, CheckCircle, AlertTriangle, Ban, Lock, LogOut, Settings, Send } from "lucide-react";
import "./style.css";

async function api(url, options = {}) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options
  });

  let data = {};
  try {
    data = await res.json();
  } catch (_) {
    data = {};
  }

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
    } catch (err) {
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
  const [domain, setDomain] = useState("");
  const [bulk, setBulk] = useState("");
  const [proxy, setProxy] = useState({ name: "", provider_name: "", proxy_url: "", proxy_type: "http" });
  const [proxies, setProxies] = useState([]);
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState({ check_interval_seconds: "60", retry_confirmations: "3", status_keywords: "internetpositif,trustpositif,nawala" });

  async function load() {
    try {
      const [overviewData, domainData, resultData, proxyData, settingsData] = await Promise.all([
        api("/api/overview"), api("/api/domains"), api("/api/results"), api("/api/proxies"), api("/api/settings")
      ]);
      setOverview(overviewData || {});
      setDomains(Array.isArray(domainData) ? domainData : []);
      setResults(Array.isArray(resultData) ? resultData : []);
      setProxies(Array.isArray(proxyData) ? proxyData : []);
      setSettings(settingsData || settings);
    } catch (err) {
      if (err.status === 401) onLogout();
      else setNotice(err.message || "Gagal load data.");
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  async function saveSettings(e) {
    e.preventDefault();
    const saved = await api("/api/settings", { method: "POST", body: JSON.stringify(settings) });
    setSettings(saved);
    setNotice("Settings saved. Scheduler interval update applies after server restart/redeploy. Retry and keywords apply immediately.");
  }

  async function sendTelegramTest() {
    setNotice("Sending Telegram test...");
    const result = await api("/api/telegram/test", { method: "POST" });
    setNotice(result.ok ? "Telegram test sent." : "Telegram test failed. Check bot token and chat id.");
  }

  async function addDomain(e) {
    e.preventDefault();
    await api("/api/domains", { method: "POST", body: JSON.stringify({ domain }) });
    setDomain("");
    load();
  }

  async function bulkImport() {
    await api("/api/domains/bulk", { method: "POST", body: JSON.stringify({ text: bulk }) });
    setBulk("");
    load();
  }

  async function addProxy(e) {
    e.preventDefault();
    await api("/api/proxies", { method: "POST", body: JSON.stringify(proxy) });
    setProxy({ name: "", provider_name: "", proxy_url: "", proxy_type: "http" });
    load();
  }

  async function manualCheck() {
    setNotice("Manual check running...");
    await api("/api/check/manual", { method: "POST" });
    setNotice("Manual check selesai.");
    load();
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    onLogout();
  }

  return (
    <div className="app">
      <aside>
        <h1>Domain Radar</h1>
        <p>Multi-checker domain monitor</p>
        <button onClick={manualCheck}><RefreshCw size={16}/> Manual Check</button>
        <button onClick={sendTelegramTest}><Send size={16}/> Telegram Test</button>
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
          <h2><Settings size={20}/> Settings</h2>
          <form onSubmit={saveSettings} className="settingsGrid">
            <label><span>Check interval seconds</span><input value={settings.check_interval_seconds} onChange={(e) => setSettings({...settings, check_interval_seconds:e.target.value})} /></label>
            <label><span>Retry confirmations</span><input value={settings.retry_confirmations} onChange={(e) => setSettings({...settings, retry_confirmations:e.target.value})} /></label>
            <label className="wide"><span>Status keywords</span><input value={settings.status_keywords} onChange={(e) => setSettings({...settings, status_keywords:e.target.value})} /></label>
            <button>Save Settings</button>
          </form>
          <p className="hint">3x check = interval × retry. Jika interval 60 detik dan retry 3, alert keluar sekitar 3 menit setelah status baru konsisten.</p>
        </section>

        <section className="panel">
          <h2>Add Domain</h2>
          <form onSubmit={addDomain} className="row">
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
            <button>Add</button>
          </form>
          <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="Bulk import, one domain per line" />
          <button onClick={bulkImport}>Bulk Import</button>
        </section>

        <section className="panel">
          <h2>Domains</h2>
          <table>
            <thead><tr><th>Domain</th><th>Status</th><th>Last Status</th><th>Last Checked</th><th>Active</th></tr></thead>
            <tbody>
              {domains.map((d) => (
                <tr key={d.id}>
                  <td>{d.domain}</td>
                  <td><Badge status={d.global_status}/></td>
                  <td>{d.last_status || "-"}</td>
                  <td>{d.last_checked_at ? new Date(d.last_checked_at).toLocaleString() : "-"}</td>
                  <td>{d.is_active ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Proxy Checker</h2>
          <form onSubmit={addProxy} className="grid">
            <input placeholder="Name" value={proxy.name} onChange={(e) => setProxy({...proxy, name:e.target.value})}/>
            <input placeholder="Provider" value={proxy.provider_name} onChange={(e) => setProxy({...proxy, provider_name:e.target.value})}/>
            <input placeholder="Proxy URL" value={proxy.proxy_url} onChange={(e) => setProxy({...proxy, proxy_url:e.target.value})}/>
            <select value={proxy.proxy_type} onChange={(e) => setProxy({...proxy, proxy_type:e.target.value})}>
              <option value="http">HTTP/HTTPS</option>
              <option value="socks">SOCKS</option>
            </select>
            <button>Add Proxy</button>
          </form>
          <div className="chips">{proxies.map((p) => <span key={p.id}>{p.provider_name}: {p.name}</span>)}</div>
        </section>

        <section className="panel">
          <h2>History</h2>
          <table>
            <thead><tr><th>Time</th><th>Domain</th><th>Checker</th><th>Status</th><th>HTTP</th><th>Reason</th></tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.checked_at).toLocaleString()}</td>
                  <td>{r.domain}</td>
                  <td>{r.provider_name}</td>
                  <td><Badge status={r.status}/></td>
                  <td>{r.http_status || "-"}</td>
                  <td>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
    try {
      const me = await api("/api/auth/me");
      setAuthenticated(Boolean(me.authenticated));
    } catch (err) {
      setBootError(err.message || "Auth check failed.");
      setAuthenticated(false);
    } finally {
      setChecked(true);
    }
  }

  useEffect(() => { checkAuth(); }, []);

  if (!checked) return <div className="loading">Loading Domain Radar...</div>;
  if (!authenticated) return (<><Login onLogin={async () => { setAuthenticated(true); }} />{bootError ? <div className="bootError">{bootError}</div> : null}</>);
  return <Dashboard onLogout={() => setAuthenticated(false)} />;
}

const rootEl = document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<App />);

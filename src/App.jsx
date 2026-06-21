import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RefreshCw, ShieldAlert, CheckCircle, AlertTriangle, Ban, Lock, LogOut } from "lucide-react";
import "./style.css";

const api = async (url, options = {}) => {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options
  });

  if (res.status === 401) {
    const error = new Error("Unauthorized");
    error.status = 401;
    throw error;
  }

  return res.json();
};

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
      onLogin();
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
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Admin password"
          autoFocus
        />
        {error && <div className="errorBox">{error}</div>}
        <button disabled={loading}>{loading ? "Checking..." : "Login"}</button>
      </form>
    </div>
  );
}

function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [overview, setOverview] = useState({});
  const [domains, setDomains] = useState([]);
  const [results, setResults] = useState([]);
  const [domain, setDomain] = useState("");
  const [bulk, setBulk] = useState("");
  const [proxy, setProxy] = useState({ name: "", provider_name: "", proxy_url: "", proxy_type: "http" });
  const [proxies, setProxies] = useState([]);

  async function checkAuth() {
    try {
      const me = await api("/api/auth/me");
      setAuthenticated(Boolean(me.authenticated));
    } catch (err) {
      setAuthenticated(false);
    } finally {
      setAuthChecked(true);
    }
  }

  async function load() {
    try {
      setOverview(await api("/api/overview"));
      setDomains(await api("/api/domains"));
      setResults(await api("/api/results"));
      setProxies(await api("/api/proxies"));
      setAuthenticated(true);
    } catch (err) {
      if (err.status === 401) setAuthenticated(false);
    }
  }

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [authenticated]);

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
    await api("/api/check/manual", { method: "POST" });
    load();
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setAuthenticated(false);
  }

  if (!authChecked) {
    return <div className="loading">Loading Domain Radar...</div>;
  }

  if (!authenticated) {
    return <Login onLogin={() => { setAuthenticated(true); load(); }} />;
  }

  return (
    <div className="app">
      <aside>
        <h1>Domain Radar</h1>
        <p>Multi-checker domain monitor</p>
        <button onClick={manualCheck}><RefreshCw size={16}/> Manual Check</button>
        <button className="ghostBtn" onClick={logout}><LogOut size={16}/> Logout</button>
      </aside>

      <main>
        <section className="cards">
          <div className="card"><ShieldAlert/> <b>{overview.total || 0}</b><span>Total</span></div>
          <div className="card"><CheckCircle/> <b>{overview.working || 0}</b><span>Working</span></div>
          <div className="card"><AlertTriangle/> <b>{overview.warning || 0}</b><span>Warning</span></div>
          <div className="card"><Ban/> <b>{overview.blocked || 0}</b><span>Blocked</span></div>
        </section>

        <section className="panel">
          <h2>Add Domain</h2>
          <form onSubmit={addDomain} className="row">
            <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="example.com" />
            <button>Add</button>
          </form>
          <textarea value={bulk} onChange={e => setBulk(e.target.value)} placeholder="Bulk import, one domain per line" />
          <button onClick={bulkImport}>Bulk Import</button>
        </section>

        <section className="panel">
          <h2>Domains</h2>
          <table>
            <thead><tr><th>Domain</th><th>Status</th><th>Last Checked</th><th>Active</th></tr></thead>
            <tbody>
              {domains.map(d => (
                <tr key={d.id}>
                  <td>{d.domain}</td>
                  <td><Badge status={d.global_status}/></td>
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
            <input placeholder="Name" value={proxy.name} onChange={e => setProxy({...proxy, name:e.target.value})}/>
            <input placeholder="Provider" value={proxy.provider_name} onChange={e => setProxy({...proxy, provider_name:e.target.value})}/>
            <input placeholder="Proxy URL" value={proxy.proxy_url} onChange={e => setProxy({...proxy, proxy_url:e.target.value})}/>
            <select value={proxy.proxy_type} onChange={e => setProxy({...proxy, proxy_type:e.target.value})}>
              <option value="http">HTTP/HTTPS</option>
              <option value="socks">SOCKS</option>
            </select>
            <button>Add Proxy</button>
          </form>
          <div className="chips">
            {proxies.map(p => <span key={p.id}>{p.provider_name}: {p.name}</span>)}
          </div>
        </section>

        <section className="panel">
          <h2>History</h2>
          <table>
            <thead><tr><th>Time</th><th>Domain</th><th>Checker</th><th>Status</th><th>HTTP</th><th>Reason</th></tr></thead>
            <tbody>
              {results.map(r => (
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

createRoot(document.getElementById("root")).render(<App />);

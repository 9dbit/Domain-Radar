require("dotenv").config();

const axios = require("axios");
const dns = require("dns").promises;
const fs = require("fs");
const { spawnSync } = require("child_process");

const CENTRAL_URL = String(process.env.CENTRAL_URL || "").replace(/\/+$/, "");
const NODE_NAME = process.env.NODE_NAME || process.env.PROVIDER_NAME || "Provider Node";
const AGENT_SECRET = process.env.AGENT_SECRET || "";
const PROVIDER_NAME = process.env.PROVIDER_NAME || NODE_NAME;
const NETWORK_TYPE = process.env.NETWORK_TYPE || "mobile";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 3000);
const STATUS_KEYWORDS = (process.env.STATUS_KEYWORDS || "internetpositif,trustpositif,nawala").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
function inferExpectedOrg() {
  const text = `${NODE_NAME} ${PROVIDER_NAME}`.toLowerCase();
  if (text.includes("telkomsel")) return "telkomsel";
  if (text.includes("indosat")) return "indosat";
  if (text.includes("xl")) return "xl";
  if (text.includes("smartfren")) return "smartfren";
  if (text.includes("biznet")) return "biznet";
  if (text.includes("indihome") || text.includes("telkom")) return "telkom";
  return "";
}

const EXPECTED_ORG = String(process.env.EXPECTED_ORG || inferExpectedOrg()).toLowerCase().trim();
const IPINFO_URL = process.env.IPINFO_URL || "https://ipinfo.io/json";

if (!CENTRAL_URL || !NODE_NAME || !AGENT_SECRET) {
  console.error("CENTRAL_URL, NODE_NAME, and AGENT_SECRET are required");
  process.exit(1);
}

function normalizeDomain(domain) {
  return String(domain || "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim().toLowerCase();
}

function readFileTrim(path) {
  try { return fs.readFileSync(path, "utf8").trim(); } catch (_) { return ""; }
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readSysfsBattery() {
  const basePaths = [
    "/sys/class/power_supply/battery",
    "/sys/class/power_supply/BAT0",
    "/sys/class/power_supply/maxfg"
  ];
  for (const base of basePaths) {
    const capacity = readFileTrim(`${base}/capacity`);
    if (!capacity) continue;
    const status = readFileTrim(`${base}/status`);
    const health = readFileTrim(`${base}/health`);
    const tempRaw = readFileTrim(`${base}/temp`) || readFileTrim(`${base}/temperature`);
    const pct = Number(capacity);
    const tempNumber = Number(tempRaw);
    let tempC = null;
    if (Number.isFinite(tempNumber)) tempC = tempNumber > 100 ? tempNumber / 10 : tempNumber;
    return {
      battery_percent: Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : null,
      is_charging: ["charging", "full"].includes(String(status).toLowerCase()),
      battery_status: status || "sysfs",
      battery_health: health || "unknown",
      battery_temperature_c: tempC
    };
  }
  return null;
}

function readTermuxBattery() {
  try {
    const run = spawnSync("termux-battery-status", [], { encoding: "utf8", timeout: 3000 });
    if (!run.error && run.stdout) {
      const data = JSON.parse(run.stdout);
      const status = String(data.status || "");
      return {
        battery_percent: typeof data.percentage === "number" ? Math.max(0, Math.min(100, Math.round(data.percentage))) : null,
        is_charging: status.toUpperCase() === "CHARGING" || status.toUpperCase() === "FULL",
        battery_status: status,
        battery_health: data.health || "",
        battery_temperature_c: typeof data.temperature === "number" ? data.temperature : null
      };
    }
  } catch (_) {}
  return null;
}

function getBatteryTelemetry() {
  const termux = readTermuxBattery();
  const sysfs = readSysfsBattery();

  if (termux && sysfs) {
    return {
      ...termux,
      battery_percent: sysfs.battery_percent ?? termux.battery_percent,
      is_charging: sysfs.is_charging ?? termux.is_charging,
      battery_status: sysfs.battery_status || termux.battery_status,
      battery_health: sysfs.battery_health || termux.battery_health,
      battery_temperature_c: sysfs.battery_temperature_c ?? termux.battery_temperature_c
    };
  }
  if (sysfs) return sysfs;
  if (termux) return termux;
  return { battery_percent: null, is_charging: null, battery_status: "unavailable", battery_health: "unknown", battery_temperature_c: null };
}

function walkNumbers(obj, keys = []) {
  const found = [];
  function visit(value, path) {
    if (value === null || value === undefined) return;
    if (typeof value === "number") found.push({ path: path.join(".").toLowerCase(), value });
    if (typeof value === "object") {
      Object.entries(value).forEach(([k, v]) => visit(v, [...path, k]));
    }
  }
  visit(obj, []);
  return found.filter((item) => !keys.length || keys.some((key) => item.path.includes(key)));
}

function normalizeRadioType(value) {
  const raw = String(value || "").toLowerCase();
  if (!raw) return "";
  if (raw.includes("nr") || raw.includes("5g")) return "5g";
  if (raw.includes("lte") || raw.includes("4g")) return "lte";
  if (raw.includes("hspa") || raw.includes("hsdpa") || raw.includes("hsupa")) return "hspa";
  if (raw.includes("umts") || raw.includes("wcdma") || raw.includes("3g")) return "umts";
  if (raw.includes("edge")) return "edge";
  if (raw.includes("gprs")) return "gprs";
  if (raw.includes("gsm") || raw.includes("2g")) return "gsm";
  if (raw.includes("cdma") || raw.includes("evdo")) return "cdma";
  return String(value || "").trim();
}

function radioDisplayLabel(value) {
  const raw = normalizeRadioType(value);
  if (!raw) return "";
  if (raw === "5g") return "5G";
  if (raw === "lte") return "4G LTE";
  if (raw === "hspa") return "3G HSPA";
  if (raw === "umts") return "3G";
  if (raw === "edge") return "EDGE";
  if (raw === "gprs") return "GPRS";
  if (raw === "gsm") return "2G GSM";
  if (raw === "cdma") return "CDMA";
  return raw.toUpperCase();
}

function signalLevelToPercent(level) {
  const n = toNumberOrNull(level);
  if (n === null) return null;
  return Math.max(0, Math.min(100, Math.round((Math.max(0, Math.min(4, n)) / 4) * 100)));
}

function dbmToPercent(dbm) {
  const n = toNumberOrNull(dbm);
  if (n === null) return null;
  if (n >= -70) return 100;
  if (n <= -120) return 0;
  return Math.round(((n + 120) / 50) * 100);
}

function getSignalTelemetry() {
  try {
    const run = spawnSync("termux-telephony-cellinfo", [], { encoding: "utf8", timeout: 3000 });
    if (run.error || !run.stdout) return {};
    const parsed = JSON.parse(run.stdout);
    const cells = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.cells) ? parsed.cells : [parsed];
    const registered = cells.find((cell) => cell?.registered === true || cell?.isRegistered === true || cell?.registered === "true") || cells[0] || {};

    const radioSource = registered.network_type || registered.networkType || registered.type || registered.cellType || registered.connectionType || registered.radio || registered.radioType || "";
    const networkType = normalizeRadioType(radioSource);
    const networkLabel = radioDisplayLabel(networkType || radioSource);

    const dbmCandidate = walkNumbers(registered, ["dbm", "rsrp", "rssi"]).map((x) => x.value).find((v) => v < 0 && v > -200);
    const asuCandidate = walkNumbers(registered, ["asu"]).map((x) => x.value).find((v) => v >= 0 && v <= 99);
    const levelCandidate = walkNumbers(registered, ["level"]).map((x) => x.value).find((v) => v >= 0 && v <= 4);
    const percentFromLevel = signalLevelToPercent(levelCandidate);
    const percentFromDbm = dbmToPercent(dbmCandidate);
    const signalPercent = percentFromLevel ?? percentFromDbm;

    return {
      signal_percent: signalPercent,
      signal_dbm: toNumberOrNull(dbmCandidate),
      signal_asu: toNumberOrNull(asuCandidate),
      signal_level: toNumberOrNull(levelCandidate),
      signal_label: networkLabel || (signalPercent !== null ? `${signalPercent}%` : ""),
      network_operator: String(registered.operator || registered.operatorName || registered.carrier || "").slice(0, 120),
      network_type_label: networkType || String(radioSource || "").toLowerCase()
    };
  } catch (_) {
    return {};
  }
}

function getTelemetry() {
  return {
    ...getBatteryTelemetry(),
    ...getSignalTelemetry()
  };
}

function classifyNetworkError(err, stage = "HTTP") {
  const code = err?.code || "";
  const msg = err?.message || "Unknown error";
  if (code === "ENOTFOUND") return "DNS not found / domain does not resolve";
  if (code === "ENODATA") return "DNS has no usable record";
  if (code === "EAI_AGAIN") return "DNS temporary failure / retry later";
  if (code === "ETIMEDOUT" || code === "ECONNABORTED") return `${stage} timeout / connection took too long`;
  if (code === "ECONNREFUSED") return `${stage} connection refused`;
  if (code === "ECONNRESET") return `${stage} connection reset by peer`;
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") return `${stage} network unreachable`;
  if (code === "CERT_HAS_EXPIRED" || code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") return `SSL certificate issue: ${code}`;
  if (/socket hang up/i.test(msg)) return `${stage} socket hang up / server closed the connection`;
  return `${stage} error: ${code || msg}`;
}

function classifyHttpStatus(statusCode) {
  if (statusCode === 403) return "HTTP 403 forbidden / access denied";
  if (statusCode === 451) return "HTTP 451 unavailable for legal reasons / possible blocking";
  if (statusCode === 429) return "HTTP 429 rate limited / too many requests";
  if (statusCode >= 500) return `HTTP ${statusCode} server error`;
  if (statusCode >= 400) return `HTTP ${statusCode} client error`;
  return `HTTP ${statusCode}`;
}

function detectSignal(text, finalUrl) {
  const haystack = `${finalUrl || ""}\n${text || ""}`.toLowerCase();
  const keyword = STATUS_KEYWORDS.find((k) => haystack.includes(k));
  if (keyword) return { matched: true, reason: `Block keyword detected: ${keyword}` };
  return { matched: false, reason: "" };
}

async function getPublicNetworkInfo() {
  if (!EXPECTED_ORG) return { ok: true, reason: "no expected org configured", data: null };
  try {
    const { data } = await axios.get(IPINFO_URL, { timeout: 8000 });
    const org = String(data?.org || "").toLowerCase();
    const ok = org.includes(EXPECTED_ORG);
    return { ok, reason: ok ? `network matched: ${data?.org || EXPECTED_ORG}` : `wrong network: expected ${EXPECTED_ORG}, got ${data?.org || "unknown org"}`, data };
  } catch (err) {
    return { ok: false, reason: `network check failed: ${err.code || err.message}`, data: null };
  }
}

async function checkDomain(domain) {
  const cleanDomain = normalizeDomain(domain);
  const started = Date.now();
  let dnsResult = "";
  let httpStatus = null;
  let finalUrl = "";
  let status = "working";
  let reason = "OK";

  try {
    const records = await dns.resolve4(cleanDomain);
    dnsResult = records.join(", ");
  } catch (err) {
    status = "warning";
    reason = classifyNetworkError(err, "DNS");
  }

  try {
    const response = await axios.get(`https://${cleanDomain}`, { timeout: 18000, maxRedirects: 5, validateStatus: () => true, headers: { "User-Agent": `DomainRadarPollAgent/1.0 ${PROVIDER_NAME}` } });
    httpStatus = response.status;
    finalUrl = response.request?.res?.responseUrl || `https://${cleanDomain}`;
    const signal = detectSignal(typeof response.data === "string" ? response.data.slice(0, 20000) : "", finalUrl);
    if (signal.matched) {
      status = "blocked";
      reason = signal.reason;
    } else if (httpStatus >= 500 || httpStatus === 403 || httpStatus === 451 || httpStatus === 429) {
      status = "warning";
      reason = classifyHttpStatus(httpStatus);
    } else if (status !== "warning") {
      status = "working";
      reason = "OK";
    }
  } catch (err) {
    status = "warning";
    reason = classifyNetworkError(err, "HTTP");
  }

  return { provider_name: PROVIDER_NAME, network_type: NETWORK_TYPE, status, http_status: httpStatus, final_url: finalUrl, dns_result: dnsResult, latency_ms: Date.now() - started, reason };
}

async function pollOnce() {
  const telemetry = getTelemetry();
  const net = await getPublicNetworkInfo();

  if (!net.ok) {
    await axios.post(`${CENTRAL_URL}/api/agent/poll`, {
      node_name: NODE_NAME,
      secret_key: AGENT_SECRET,
      telemetry,
      network_ok: false,
      network_reason: net.reason
    }, { timeout: 30000 });
    console.log(`[${new Date().toISOString()}] Waiting: ${net.reason}`);
    return;
  }

  const { data } = await axios.post(`${CENTRAL_URL}/api/agent/poll`, { node_name: NODE_NAME, secret_key: AGENT_SECRET, telemetry, network_ok: true, network_reason: net.reason }, { timeout: 30000 });
  if (!data.task) return;
  const { id, domain } = data.task;
  console.log(`[${new Date().toISOString()}] Task ${id}: ${domain}`);
  const result = await checkDomain(domain);
  await axios.post(`${CENTRAL_URL}/api/agent/result`, { node_name: NODE_NAME, secret_key: AGENT_SECRET, task_id: id, result, telemetry: getTelemetry() }, { timeout: 30000 });
  console.log(`[${new Date().toISOString()}] Done ${domain}: ${result.status} / ${result.reason}`);
}

async function loop() {
  console.log(`Polling provider agent started`);
  console.log(`Central: ${CENTRAL_URL}`);
  console.log(`Node: ${NODE_NAME}`);
  console.log(`Provider: ${PROVIDER_NAME}`);
  console.log(`Network: ${NETWORK_TYPE}`);
  console.log(`Expected org: ${EXPECTED_ORG || "not configured"}`);
  console.log(`Telemetry: ${JSON.stringify(getTelemetry())}`);
  while (true) {
    try { await pollOnce(); } catch (err) { console.error(`[${new Date().toISOString()}] Poll error: ${err.response?.data?.error || err.code || err.message}`); }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

loop();

require("dotenv").config();

const axios = require("axios");
const dns = require("dns").promises;
const { spawnSync } = require("child_process");

const CENTRAL_URL = String(process.env.CENTRAL_URL || "").replace(/\/+$/, "");
const NODE_NAME = process.env.NODE_NAME || process.env.PROVIDER_NAME || "Provider Node";
const AGENT_SECRET = process.env.AGENT_SECRET || "";
const PROVIDER_NAME = process.env.PROVIDER_NAME || NODE_NAME;
const NETWORK_TYPE = process.env.NETWORK_TYPE || "mobile";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 3000);
const STATUS_KEYWORDS = (process.env.STATUS_KEYWORDS || "internetpositif,trustpositif,nawala").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

if (!CENTRAL_URL || !NODE_NAME || !AGENT_SECRET) {
  console.error("CENTRAL_URL, NODE_NAME, and AGENT_SECRET are required");
  process.exit(1);
}

function normalizeDomain(domain) {
  return String(domain || "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim().toLowerCase();
}

function getBatteryTelemetry() {
  try {
    const run = spawnSync("termux-battery-status", [], { encoding: "utf8", timeout: 3000 });
    if (run.error || !run.stdout) throw run.error || new Error("battery unavailable");
    const data = JSON.parse(run.stdout);
    const status = String(data.status || "");
    return {
      battery_percent: typeof data.percentage === "number" ? data.percentage : null,
      is_charging: status.toUpperCase() === "CHARGING" || status.toUpperCase() === "FULL",
      battery_status: status,
      battery_health: data.health || "",
      battery_temperature_c: typeof data.temperature === "number" ? data.temperature : null
    };
  } catch (_) {
    return { battery_percent: null, is_charging: null, battery_status: "unavailable", battery_health: "unknown", battery_temperature_c: null };
  }
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
  const telemetry = getBatteryTelemetry();
  const { data } = await axios.post(`${CENTRAL_URL}/api/agent/poll`, { node_name: NODE_NAME, secret_key: AGENT_SECRET, telemetry }, { timeout: 30000 });
  if (!data.task) return;
  const { id, domain } = data.task;
  console.log(`[${new Date().toISOString()}] Task ${id}: ${domain}`);
  const result = await checkDomain(domain);
  await axios.post(`${CENTRAL_URL}/api/agent/result`, { node_name: NODE_NAME, secret_key: AGENT_SECRET, task_id: id, result, telemetry: getBatteryTelemetry() }, { timeout: 30000 });
  console.log(`[${new Date().toISOString()}] Done ${domain}: ${result.status} / ${result.reason}`);
}

async function loop() {
  console.log(`Polling provider agent started`);
  console.log(`Central: ${CENTRAL_URL}`);
  console.log(`Node: ${NODE_NAME}`);
  console.log(`Provider: ${PROVIDER_NAME}`);
  console.log(`Network: ${NETWORK_TYPE}`);
  while (true) {
    try { await pollOnce(); } catch (err) { console.error(`[${new Date().toISOString()}] Poll error: ${err.response?.data?.error || err.code || err.message}`); }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

loop();

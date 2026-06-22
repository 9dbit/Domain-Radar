const axios = require("axios");
const dns = require("dns").promises;
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { getRuntimeSettings } = require("./runtimeSettings");

function getKeywords() {
  const raw = getRuntimeSettings().status_keywords || "internetpositif,trustpositif,nawala";
  return raw.split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
}

function normalizeDomain(domain) {
  return String(domain || "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
}

function createProxyAgent(proxy) {
  if (!proxy?.proxy_url) return undefined;
  if (proxy.proxy_type === "socks" || proxy.proxy_url.startsWith("socks")) return new SocksProxyAgent(proxy.proxy_url);
  return new HttpsProxyAgent(proxy.proxy_url);
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
  if (/proxy authentication/i.test(msg)) return "Proxy authentication failed / invalid proxy username or password";
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

function detectPageSignal(text, finalUrl) {
  const haystack = `${finalUrl || ""}\n${text || ""}`.toLowerCase();
  const keyword = getKeywords().find(k => haystack.includes(k));
  if (keyword) return { matched: true, reason: `Block keyword detected: ${keyword}` };
  return { matched: false, reason: "" };
}

async function checkDomain(domain, checker = { type: "direct", provider_name: "Direct" }) {
  const cleanDomain = normalizeDomain(domain);
  const started = Date.now();
  let dnsResult = "";
  let httpStatus = null;
  let finalUrl = "";
  let reason = "";
  let status = "working";

  try {
    const records = await dns.resolve4(cleanDomain);
    dnsResult = records.join(", ");
  } catch (err) {
    status = "warning";
    reason = classifyNetworkError(err, "DNS");
  }

  try {
    const proxyAgent = createProxyAgent(checker.proxy);
    const response = await axios.get(`https://${cleanDomain}`, {
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: () => true,
      httpsAgent: proxyAgent,
      httpAgent: proxyAgent,
      headers: { "User-Agent": "Mozilla/5.0 DomainRadar/1.0" }
    });

    httpStatus = response.status;
    finalUrl = response.request?.res?.responseUrl || `https://${cleanDomain}`;
    const signal = detectPageSignal(typeof response.data === "string" ? response.data.slice(0, 20000) : "", finalUrl);

    if (signal.matched) {
      status = "blocked";
      reason = signal.reason;
    } else if (httpStatus >= 500 || httpStatus === 403 || httpStatus === 451 || httpStatus === 429) {
      status = "warning";
      reason = classifyHttpStatus(httpStatus);
    } else if (!reason) {
      status = "working";
      reason = "OK";
    }
  } catch (err) {
    if (status !== "warning") status = "warning";
    reason = classifyNetworkError(err, "HTTP");
  }

  return {
    domain: cleanDomain,
    checker_type: checker.type || "direct",
    provider_name: checker.provider_name || "Direct",
    status,
    http_status: httpStatus,
    final_url: finalUrl,
    dns_result: dnsResult,
    latency_ms: Date.now() - started,
    reason
  };
}

function calculateGlobalStatus(results) {
  if (results.some(r => r.status === "blocked")) return "blocked";
  if (results.some(r => r.status === "warning")) return "warning";
  if (results.every(r => r.status === "working")) return "working";
  return "unknown";
}

module.exports = { checkDomain, calculateGlobalStatus, normalizeDomain, classifyNetworkError, classifyHttpStatus };

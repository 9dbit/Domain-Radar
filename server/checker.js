const axios = require("axios");
const dns = require("dns").promises;
const { HttpsProxyAgent } = require("https-proxy-agent");
const { SocksProxyAgent } = require("socks-proxy-agent");

function getKeywords() {
  const raw = process.env.STATUS_KEYWORDS || "internetpositif,trustpositif,nawala";
  return raw.split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
}

function normalizeDomain(domain) {
  return domain
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
}

function createProxyAgent(proxy) {
  if (!proxy?.proxy_url) return undefined;
  if (proxy.proxy_type === "socks" || proxy.proxy_url.startsWith("socks")) {
    return new SocksProxyAgent(proxy.proxy_url);
  }
  return new HttpsProxyAgent(proxy.proxy_url);
}

function detectPageSignal(text, finalUrl) {
  const haystack = `${finalUrl || ""}\n${text || ""}`.toLowerCase();
  const keyword = getKeywords().find(k => haystack.includes(k));
  if (keyword) {
    return { matched: true, reason: `Detected keyword: ${keyword}` };
  }
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
    reason = `DNS error: ${err.code || err.message}`;
  }

  try {
    const proxyAgent = createProxyAgent(checker.proxy);
    const response = await axios.get(`https://${cleanDomain}`, {
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: () => true,
      httpsAgent: proxyAgent,
      httpAgent: proxyAgent,
      headers: {
        "User-Agent": "Mozilla/5.0 DomainRadar/1.0"
      }
    });

    httpStatus = response.status;
    finalUrl = response.request?.res?.responseUrl || `https://${cleanDomain}`;

    const signal = detectPageSignal(
      typeof response.data === "string" ? response.data.slice(0, 20000) : "",
      finalUrl
    );

    if (signal.matched) {
      status = "blocked";
      reason = signal.reason;
    } else if (httpStatus >= 500 || httpStatus === 403 || httpStatus === 451) {
      status = "warning";
      reason = `Suspicious HTTP status: ${httpStatus}`;
    } else if (!reason) {
      status = "working";
      reason = "OK";
    }
  } catch (err) {
    if (status !== "warning") status = "warning";
    reason = `HTTP error: ${err.code || err.message}`;
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

module.exports = { checkDomain, calculateGlobalStatus, normalizeDomain };

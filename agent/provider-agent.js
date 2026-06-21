require("dotenv").config();

const express = require("express");
const axios = require("axios");
const dns = require("dns").promises;

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.AGENT_PORT || process.env.PORT || 4100;
const AGENT_SECRET = process.env.AGENT_SECRET || "";
const PROVIDER_NAME = process.env.PROVIDER_NAME || "Provider Node";
const NETWORK_TYPE = process.env.NETWORK_TYPE || "broadband";
const STATUS_KEYWORDS = (process.env.STATUS_KEYWORDS || "internetpositif,trustpositif,nawala")
  .split(",")
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean);

function requireSecret(req, res, next) {
  if (!AGENT_SECRET) return next();
  if (req.headers["x-domain-radar-secret"] === AGENT_SECRET) return next();
  return res.status(401).json({ error: "Unauthorized agent request" });
}

function normalizeDomain(domain) {
  return String(domain || "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
}

function detectSignal(text, finalUrl) {
  const haystack = `${finalUrl || ""}\n${text || ""}`.toLowerCase();
  const keyword = STATUS_KEYWORDS.find((k) => haystack.includes(k));
  if (keyword) return { matched: true, reason: `Detected keyword: ${keyword}` };
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
    reason = `DNS error: ${err.code || err.message}`;
  }

  try {
    const response = await axios.get(`https://${cleanDomain}`, {
      timeout: 18000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: { "User-Agent": `DomainRadarProviderAgent/1.0 ${PROVIDER_NAME}` }
    });

    httpStatus = response.status;
    finalUrl = response.request?.res?.responseUrl || `https://${cleanDomain}`;
    const signal = detectSignal(typeof response.data === "string" ? response.data.slice(0, 20000) : "", finalUrl);

    if (signal.matched) {
      status = "blocked";
      reason = signal.reason;
    } else if (httpStatus >= 500 || httpStatus === 403 || httpStatus === 451) {
      status = "warning";
      reason = `Suspicious HTTP status: ${httpStatus}`;
    } else if (status !== "warning") {
      status = "working";
      reason = "OK";
    }
  } catch (err) {
    status = "warning";
    reason = `HTTP error: ${err.code || err.message}`;
  }

  return {
    provider_name: PROVIDER_NAME,
    network_type: NETWORK_TYPE,
    status,
    http_status: httpStatus,
    final_url: finalUrl,
    dns_result: dnsResult,
    latency_ms: Date.now() - started,
    reason
  };
}

app.get("/health", requireSecret, (req, res) => {
  res.json({ ok: true, provider_name: PROVIDER_NAME, network_type: NETWORK_TYPE, time: new Date().toISOString() });
});

app.post("/check", requireSecret, async (req, res) => {
  try {
    const result = await checkDomain(req.body.domain);
    res.json(result);
  } catch (err) {
    res.status(500).json({ status: "warning", reason: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Provider agent ${PROVIDER_NAME} running on ${PORT}`);
});

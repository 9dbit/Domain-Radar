const axios = require("axios");

const DEFAULT_BASE_URL = "https://trustpositif.komdigi.go.id";

function cleanDomain(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function stripTags(value = "") {
  return String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function cookieHeader(headers = {}) {
  const cookies = headers["set-cookie"] || [];
  return cookies.map((item) => String(item).split(";")[0]).filter(Boolean).join("; ");
}

function findToken(html = "") {
  const patterns = [
    /name=["']csrf_token["'][^>]*value=["']([^"']+)["']/i,
    /csrf_token["']?\s*[:=]\s*["']([^"']+)["']/i,
    /csrf-token["']?\s*content=["']([^"']+)["']/i,
    /welcome\?csrf_token=([^&"']+)/i
  ];
  for (const pattern of patterns) {
    const match = String(html).match(pattern);
    if (match && match[1]) return decodeURIComponent(match[1]);
  }
  return "";
}

function parseProviderRegistryText(text = "", domain = "") {
  const clean = cleanDomain(domain);
  const body = stripTags(text).toLowerCase();
  const idx = body.indexOf(clean);
  const nearby = idx >= 0 ? body.slice(idx, idx + 260) : body.slice(0, 260);
  const clear = nearby.includes("tidak ada") || nearby.includes("tidak terdaftar");
  const blocked = !clear && (nearby.includes(" ada") || nearby.includes("status ada") || nearby.endsWith("ada"));
  return {
    domain: clean,
    checked: true,
    blocked,
    status: blocked ? "Ada" : "Tidak Ada",
    raw_excerpt: nearby.slice(0, 260)
  };
}

function buildWelcomeUrl(baseUrl, token, domain) {
  const params = new URLSearchParams();
  if (token) params.set("csrf_token", token);
  params.set("recaptcha_token", "");
  params.set("domains", domain);
  return `${baseUrl}/welcome?${params.toString()}`;
}

async function verifyProviderBlock(domain) {
  const clean = cleanDomain(domain);
  const baseUrl = String(process.env.PROVIDER_BLOCK_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const timeout = Number(process.env.PROVIDER_BLOCK_TIMEOUT_MS || 5000);

  if (!clean) {
    return { domain: clean, checked: false, blocked: false, status: "SKIPPED", reason: "empty domain" };
  }

  try {
    const client = axios.create({
      timeout,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        "User-Agent": "Mozilla/5.0 DomainRadar/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    const home = await client.get(`${baseUrl}/index.php`);
    const cookies = cookieHeader(home.headers || {});
    const token = findToken(home.data || "");
    const url = buildWelcomeUrl(baseUrl, token, clean);

    const response = await client.get(url, {
      headers: {
        Cookie: cookies,
        Referer: `${baseUrl}/index.php`
      }
    });

    return parseProviderRegistryText(response.data || "", clean);
  } catch (err) {
    return {
      domain: clean,
      checked: false,
      blocked: false,
      status: "ERROR",
      reason: err.code || err.message || "provider registry verification failed"
    };
  }
}

module.exports = { verifyProviderBlock, parseProviderRegistryText, cleanDomain };

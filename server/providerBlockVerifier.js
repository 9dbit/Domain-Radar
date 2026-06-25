const axios = require("axios");

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

function parseProviderRegistryText(text = "", domain = "") {
  const clean = cleanDomain(domain);
  const body = stripTags(text).toLowerCase();
  const idx = body.indexOf(clean);
  const nearby = idx >= 0 ? body.slice(idx, idx + 220) : body;
  const blocked = nearby.includes(" ada") && !nearby.includes("tidak ada");
  return {
    domain: clean,
    checked: true,
    blocked,
    status: blocked ? "Ada" : "Tidak Ada",
    raw_excerpt: nearby.slice(0, 220)
  };
}

async function verifyProviderBlock(domain) {
  const clean = cleanDomain(domain);
  const endpoint = process.env.PROVIDER_BLOCK_LOOKUP_URL || "";
  if (!endpoint || !clean) {
    return { domain: clean, checked: false, blocked: false, status: "SKIPPED", reason: "provider block endpoint not configured" };
  }

  const url = endpoint
    .replace("{domain}", encodeURIComponent(clean))
    .replace("{domains}", encodeURIComponent(clean));

  const response = await axios.get(url, {
    timeout: Number(process.env.PROVIDER_BLOCK_TIMEOUT_MS || 15000),
    validateStatus: () => true,
    headers: { "User-Agent": "Mozilla/5.0 DomainRadar/1.0" }
  });

  return parseProviderRegistryText(response.data || "", clean);
}

module.exports = { verifyProviderBlock, parseProviderRegistryText, cleanDomain };

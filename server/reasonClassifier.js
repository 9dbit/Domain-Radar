function classifyReasonType(result = {}) {
  const reason = String(result.reason || "").toLowerCase();
  const finalUrl = String(result.final_url || "").toLowerCase();
  const status = String(result.status || "").toLowerCase();
  const http = Number(result.http_status || 0);
  const haystack = `${reason} ${finalUrl}`;

  if (haystack.includes("internetpositif") || haystack.includes("trustpositif") || haystack.includes("nawala")) {
    return "BLOCKED_BY_PROVIDER";
  }
  if (reason.includes("block keyword detected")) return "BLOCKED_BY_PROVIDER";
  if (reason.includes("dns not found") || reason.includes("does not resolve") || reason.includes("enotfound") || reason.includes("dns has no usable record") || reason.includes("temporary failure")) {
    return "DNS_ISSUE";
  }
  if (reason.includes("ssl certificate") || reason.includes("certificate")) return "SSL_ISSUE";
  if (reason.includes("too many redirects") || reason.includes("err_fr_too_many_redirects")) return "REDIRECT_ISSUE";
  if (reason.includes("timeout") || reason.includes("connection reset") || reason.includes("socket hang up") || reason.includes("network unreachable")) return "TIMEOUT";
  if (reason.includes("node polling timeout") || reason.includes("no response from device") || reason.includes("wrong network")) return "NODE_ISSUE";
  if (http === 451) return "BLOCKED_BY_PROVIDER";
  if (http === 403 || http === 429) return "HTTP_BLOCK";
  if (http >= 500) return "HOSTING_ISSUE";
  if (status === "working" || reason === "ok") return "NORMAL";
  if (status === "blocked") return "BLOCKED_BY_PROVIDER";
  if (status === "warning") return "TECHNICAL_WARNING";

  return "UNKNOWN";
}

function reasonTypeLabel(type) {
  const map = {
    NORMAL: "✅ Normal",
    BLOCKED_BY_PROVIDER: "🛡 Provider Block",
    DNS_ISSUE: "🌐 DNS Issue",
    SSL_ISSUE: "🔒 SSL Issue",
    REDIRECT_ISSUE: "🔁 Redirect Issue",
    TIMEOUT: "⏱ Timeout",
    HTTP_BLOCK: "🚫 HTTP Block",
    HOSTING_ISSUE: "🧩 Hosting Issue",
    NODE_ISSUE: "📡 Node Issue",
    TECHNICAL_WARNING: "⚠️ Technical Warning",
    UNKNOWN: "❔ Unknown"
  };
  return map[type] || map.UNKNOWN;
}

module.exports = { classifyReasonType, reasonTypeLabel };

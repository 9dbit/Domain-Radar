function normalizeStatus(status) {
  const value = String(status || "unknown").toLowerCase().trim();
  if (["normal", "ok", "online", "success", "working"].includes(value)) return "working";
  if (["warn", "warning", "timeout", "error"].includes(value)) return "warning";
  if (["block", "blocked", "down", "offline"].includes(value)) return "blocked";
  return value || "unknown";
}

function safeText(value, max = 700) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function detectCause(item = {}) {
  const provider = String(item.provider_name || item.checker || "").toLowerCase();
  const reason = String(item.reason || "").toLowerCase();
  const finalUrl = String(item.final_url || "").trim();
  const httpStatus = Number(item.http_status || 0);

  if (provider.includes("trustpositif") || reason.includes("trustpositif status ada")) return "TrustPositif registry block";
  if (reason.includes("wrong network") || reason.includes("network check failed") || reason.includes("node polling timeout") || reason.includes("no response from device")) return "Provider node or network issue";
  if (reason.includes("ssl") || reason.includes("certificate") || reason.includes("issuer")) return "SSL certificate issue";
  if (reason.includes("dns") || reason.includes("resolve") || reason.includes("enotfound") || reason.includes("enodata")) return "DNS issue";
  if (finalUrl) return "Redirect detected";
  if (httpStatus === 403 || httpStatus === 451 || reason.includes("forbidden") || reason.includes("legal reasons")) return "HTTP access block";
  if (reason.includes("timeout") || reason.includes("took too long")) return "Timeout or unstable connection";
  return safeText(item.reason || "Unknown issue", 160);
}

function riskFromStatus(newStatus, cause) {
  const status = normalizeStatus(newStatus);
  const text = String(cause || "").toLowerCase();
  if (status === "blocked" && text.includes("trustpositif")) return { level: "CRITICAL", score: 95 };
  if (status === "blocked") return { level: "HIGH", score: 85 };
  if (status === "warning" && text.includes("provider node")) return { level: "LOW", score: 25 };
  if (status === "warning" && text.includes("ssl")) return { level: "MEDIUM", score: 55 };
  if (status === "warning" && text.includes("dns")) return { level: "MEDIUM", score: 60 };
  if (status === "warning") return { level: "MEDIUM", score: 50 };
  return { level: "LOW", score: 15 };
}

function generateIncidentAdvice({ newStatus, worst }) {
  const cause = detectCause(worst || {});
  const risk = riskFromStatus(newStatus, cause);
  const status = normalizeStatus(newStatus);
  const causeLower = cause.toLowerCase();
  let action = "Keep monitoring. No urgent action needed.";
  let confidence = "medium";

  if (status === "blocked" && causeLower.includes("trustpositif")) {
    action = "Pause active use, mark as blocked, and prepare a clean replacement domain.";
    confidence = "high";
  } else if (status === "blocked") {
    action = "Pause active use, verify evidence, then decide repair or replacement.";
  } else if (status === "warning" && causeLower.includes("provider node")) {
    action = "Treat as node/network issue. Check provider device before changing domain plan.";
  } else if (status === "warning" && causeLower.includes("ssl")) {
    action = "Check SSL chain, certificate expiry, HTTPS redirect, and proxy SSL mode.";
  } else if (status === "warning" && causeLower.includes("dns")) {
    action = "Check nameserver, DNS records, propagation, and registrar status.";
  } else if (status === "warning") {
    action = "Recheck with direct, proxy, and provider nodes before escalating.";
  }

  return [
    `Risk: ${risk.level} (${risk.score}/100)`,
    `Diagnosis: ${cause}`,
    `Evidence: ${safeText(worst?.provider_name || worst?.checker_type || "unknown checker", 80)} / ${safeText(worst?.reason || "-", 180)}`,
    `Action: ${action}`,
    `Confidence: ${confidence}`
  ].join("\n");
}

function generateHourlySummary({ domains = [], normal = [], warning = [], blockedOnly = [], redirected = [] }) {
  const totalBlocked = blockedOnly.length + redirected.length;
  const priority = totalBlocked > 0
    ? `Review ${totalBlocked} blocked domain(s), separated between pure block and redirected block.`
    : warning.length > 0
      ? `Check ${warning.length} warning domain(s) for DNS, SSL, redirect, or node issues.`
      : "No urgent incident. Continue scheduled monitoring.";

  return [
    `Overview: ${domains.length} active domains, ${normal.length} normal, ${warning.length} warning, ${totalBlocked} blocked.`,
    `Priority: ${priority}`,
    "Action: Keep blocked, warning, and redirected domains separated for cleaner handling."
  ].join("\n");
}

module.exports = { generateIncidentAdvice, generateHourlySummary };

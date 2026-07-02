const cron = require("node-cron");
const { pool } = require("./db");
const { checkDomain, calculateGlobalStatus } = require("./checker");
const { sendTelegram } = require("./telegram");
const { decide } = require("./confirm");
const { getRuntimeSettings } = require("./runtimeSettings");
const { getActiveNodes, checkViaNode } = require("./nodeChecker");
const { classifyReasonType, reasonTypeLabel } = require("./reasonClassifier");
const { verifyProviderBlock } = require("./providerBlockVerifier");
const { isAcknowledged, clearAcknowledged } = require("./noticeState");

let running = false;
let reasonTypeColumnReady = false;
let digestRunning = false;
let digestWatchdogStarted = false;

const ALERT_COOLDOWN_MINUTES = Number(process.env.ALERT_COOLDOWN_MINUTES || 60);
const DIGEST_INTERVAL_MINUTES = Number(process.env.DIGEST_INTERVAL_MINUTES || 10);
const DIGEST_LIMIT = Number(process.env.TELEGRAM_DIGEST_LIMIT || 120);
const DIGEST_WATCHDOG_MINUTES = Number(process.env.TELEGRAM_DIGEST_WATCHDOG_MINUTES || 5);
const TRUSTPOSITIF_ON_DIRECT_WARNING = String(process.env.TRUSTPOSITIF_ON_DIRECT_WARNING || "true").toLowerCase() !== "false";
const DASHBOARD_URL = process.env.DOMAIN_RADAR_DASHBOARD_URL || "https://domain-radar.org";

function getRetryLimit() {
  const value = Number(getRuntimeSettings().retry_confirmations || 3);
  return Number.isFinite(value) && value > 0 ? value : 3;
}

function getCronExpr() {
  const interval = Number(getRuntimeSettings().check_interval_seconds || 60);
  return interval <= 60 ? "* * * * *" : `*/${Math.ceil(interval / 60)} * * * *`;
}

function nowWib() {
  return new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
}

function normalizeStatus(status) {
  const value = String(status || "unknown").toLowerCase().trim();
  if (["normal", "ok", "online", "success"].includes(value)) return "working";
  if (["warn", "warning", "timeout", "error"].includes(value)) return "warning";
  if (["block", "blocked", "down", "offline"].includes(value)) return "blocked";
  return value || "unknown";
}

function isNodeTimeout(result) {
  const text = String(result?.reason || "").toLowerCase();
  return text.includes("node polling timeout") || text.includes("no response from device");
}

function hasProviderNodeWarning(results) {
  return results.some((r) => {
    const checker = String(r.checker_type || "").toLowerCase();
    return checker.includes("node") && normalizeStatus(r.status) === "warning" && !isNodeTimeout(r);
  });
}

function hasDirectWarning(results) {
  return results.some((r) => {
    const checker = String(r.checker_type || "").toLowerCase();
    return checker === "direct" && normalizeStatus(r.status) === "warning";
  });
}

function shouldCheckProviderRegistry(domain, results) {
  // No longer skip already-blocked domains — they need re-validation to self-correct

  if (hasProviderNodeWarning(results)) {
    return { check: true, reason: "provider node warning" };
  }

  // Also trigger when nodes report blocked (to confirm or deny ISP block)
  if (results.some(r => String(r.checker_type || "").startsWith("node:") && r.status === "blocked")) {
    return { check: true, reason: "provider node blocked" };
  }

  if (TRUSTPOSITIF_ON_DIRECT_WARNING && hasDirectWarning(results)) {
    return { check: true, reason: "direct warning" };
  }

  // Also trigger when direct check reports blocked
  if (results.some(r => r.checker_type === "direct" && r.status === "blocked")) {
    return { check: true, reason: "direct blocked" };
  }

  return { check: false, reason: "no provider-node/direct warning or block" };
}

async function maybeAddProviderRegistryResult(domain, results) {
  const decision = shouldCheckProviderRegistry(domain, results);
  if (!decision.check) {
    if (process.env.TRUSTPOSITIF_DEBUG === "true") {
      console.log(`[TrustPositif] skip ${domain.domain}: ${decision.reason}`);
    }
    return;
  }

  try {
    console.log(`[TrustPositif] checking ${domain.domain}: ${decision.reason}`);
    const registry = await verifyProviderBlock(domain.domain);

    if (!registry.checked) {
      console.log(`[TrustPositif] error ${domain.domain}: ${registry.reason || registry.status || "unchecked"}`);
      return;
    }

    const result = registry.blocked
      ? {
          checker_type: "provider_registry",
          provider_name: "TrustPositif",
          status: "blocked",
          http_status: 451,
          final_url: "",
          dns_result: "",
          latency_ms: null,
          reason: "TrustPositif status Ada"
        }
      : {
          checker_type: "provider_registry",
          provider_name: "TrustPositif",
          status: "working",
          http_status: 200,
          final_url: "",
          dns_result: "",
          latency_ms: null,
          reason: "TrustPositif status Tidak Ada"
        };

    results.push(result);
    console.log(`[TrustPositif] result ${domain.domain}: ${result.status} / ${result.reason}`);
  } catch (err) {
    console.error("Provider registry verification error:", domain.domain, err.message);
  }
}

function isImportantTransition(oldStatus, newStatus, worst) {
  const oldValue = normalizeStatus(oldStatus);
  const newValue = normalizeStatus(newStatus);

  if (oldValue === newValue) return false;
  if (isNodeTimeout(worst)) return false;

  if (oldValue === "working" && newValue === "warning") return true;
  if (["working", "warning", "unknown"].includes(oldValue) && newValue === "blocked") return true;

  return false;
}

async function ensureReasonTypeColumn() {
  if (reasonTypeColumnReady) return;
  await pool.query("ALTER TABLE check_results ADD COLUMN IF NOT EXISTS reason_type TEXT DEFAULT 'UNKNOWN'");
  reasonTypeColumnReady = true;
}

async function sentRecently(domainId, newStatus) {
  const { rows } = await pool.query(
    `SELECT id
     FROM alerts
     WHERE domain_id=$1
       AND new_status=$2
       AND sent_to_telegram=true
       AND created_at > NOW() - ($3::text || ' minutes')::interval
     LIMIT 1`,
    [domainId, newStatus, String(ALERT_COOLDOWN_MINUTES)]
  );

  return Boolean(rows[0]);
}

async function ensureDigestTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS telegram_digest_state (
      key TEXT PRIMARY KEY,
      last_sent_at TIMESTAMP
    )
  `);
}

function iconFor(status, finalUrl = "") {
  const value = normalizeStatus(status);
  if (value === "working") return "✅";
  if (value === "warning") return "⚠️";
  if (value === "blocked" && finalUrl) return "➡️";
  if (value === "blocked") return "❗";
  return "•";
}

function projectName(value) {
  return String(value || "").trim() || "No Project";
}

function safeCell(value) {
  return String(value || "-").replace(/\|/g, "/").replace(/[\r\n]+/g, " ").trim() || "-";
}

function truncateCell(value, max = 80) {
  const text = safeCell(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function buildProjectSummary(domains) {
  const map = new Map();

  for (const domain of domains) {
    const project = projectName(domain.project_name);
    if (!map.has(project)) {
      map.set(project, { project, normal: 0, warning: 0, blocked: 0, redirected: 0, total: 0 });
    }

    const row = map.get(project);
    const status = normalizeStatus(domain.global_status);
    const redirected = Boolean(domain.final_url);

    row.total += 1;
    if (status === "working") row.normal += 1;
    else if (status === "warning") row.warning += 1;
    else if (status === "blocked" && redirected) row.redirected += 1;
    else if (status === "blocked") row.blocked += 1;
  }

  return Array.from(map.values()).sort((a, b) => a.project.localeCompare(b.project));
}

function formatProjectSummaryTable(rows) {
  if (!rows.length) return "-";

  const lines = [
    "| Project | Domain | Status |",
    "|---|---:|---|"
  ];

  for (const row of rows) {
    if (row.normal) lines.push(`| ${safeCell(row.project)} | ${row.normal} | 🟢 Normal |`);
    if (row.warning) lines.push(`| ${safeCell(row.project)} | ${row.warning} | 🟡 Warning |`);
    if (row.blocked) lines.push(`| ${safeCell(row.project)} | ${row.blocked} | 🔴 Blocked |`);
    if (row.redirected) lines.push(`| ${safeCell(row.project)} | ${row.redirected} | ➡️ Redirected |`);
  }

  return lines.join("\n");
}

function formatDetailedDomainTable(title, rows, mode) {
  if (!rows.length) return `${title}\n-`;

  const lines = [
    title,
    "| Project | Domain | Provider / Direct | Detail |",
    "|---|---|---|---|"
  ];

  for (const row of rows.slice(0, DIGEST_LIMIT)) {
    const provider = row.provider_name || row.checker_type || "-";
    const detail = mode === "redirected" ? `➡️ ${row.final_url || "-"}` : (row.reason || "Blocked");
    lines.push(`| ${safeCell(projectName(row.project_name))} | ${safeCell(row.domain)} | ${safeCell(provider)} | ${truncateCell(detail, 90)} |`);
  }

  if (rows.length > DIGEST_LIMIT) {
    lines.push(`...and ${rows.length - DIGEST_LIMIT} more`);
  }

  return lines.join("\n");
}

async function latestDomainStatusRows() {
  const { rows } = await pool.query(`
    SELECT
      d.id,
      d.domain,
      d.project_name,
      d.global_status,
      latest.provider_name,
      latest.checker_type,
      latest.reason,
      latest.checked_at,
      COALESCE(final.final_url, latest.final_url, '') AS final_url
    FROM domains d
    LEFT JOIN LATERAL (
      SELECT provider_name, checker_type, reason, final_url, checked_at
      FROM check_results r
      WHERE r.domain_id = d.id
      ORDER BY r.checked_at DESC
      LIMIT 1
    ) latest ON TRUE
    LEFT JOIN LATERAL (
      SELECT final_url
      FROM check_results r
      WHERE r.domain_id = d.id AND COALESCE(r.final_url, '') <> ''
      ORDER BY r.checked_at DESC
      LIMIT 1
    ) final ON TRUE
    WHERE d.is_active=true
    ORDER BY COALESCE(NULLIF(d.project_name, ''), 'No Project') ASC, d.domain ASC
  `);

  return rows;
}

async function sendHourlyDigestIfDue(source = "scheduler") {
  if (digestRunning) {
    console.log(`[TelegramDigest] skipped ${source}: digest already running`);
    return false;
  }

  digestRunning = true;

  try {
    await ensureDigestTable();

    const { rows: state } = await pool.query(
      "SELECT last_sent_at FROM telegram_digest_state WHERE key='hourly_status_report' LIMIT 1"
    );

    const lastSentAt = state[0]?.last_sent_at ? new Date(state[0].last_sent_at).getTime() : 0;
    const intervalMs = DIGEST_INTERVAL_MINUTES * 60 * 1000;

    if (lastSentAt && Date.now() - lastSentAt < intervalMs) return false;

    const domains = await latestDomainStatusRows();
    const normal = domains.filter((d) => normalizeStatus(d.global_status) === "working");
    const warning = domains.filter((d) => normalizeStatus(d.global_status) === "warning");
    const blocked = domains.filter((d) => normalizeStatus(d.global_status) === "blocked");
    const redirected = blocked.filter((d) => d.final_url);
    const blockedOnly = blocked.filter((d) => !d.final_url);
    const summaryRows = buildProjectSummary(domains);

    const message = [
      "DOMAIN RADAR REPORT",
      "",
      `Time: ${nowWib()} WIB`,
      `Interval: ${DIGEST_INTERVAL_MINUTES} minutes`,
      `Total Active Domains: ${domains.length}`,
      `🟢 Normal: ${normal.length}`,
      `🟡 Warning: ${warning.length}`,
      `🔴 Blocked: ${blockedOnly.length}`,
      `➡️ Redirected: ${redirected.length}`,
      "",
      "PROJECT SUMMARY",
      formatProjectSummaryTable(summaryRows),
      "",
      `Please check all domains with warning status at: ${DASHBOARD_URL}`,
      "",
      formatDetailedDomainTable("BLOCKED DOMAINS", blockedOnly, "blocked"),
      "",
      formatDetailedDomainTable("REDIRECTED DOMAINS", redirected, "redirected")
    ].join("\n");

    const sent = await sendTelegram(message, {
      reply_markup: {
        inline_keyboard: [[{ text: "Open Domain Radar", url: DASHBOARD_URL }]]
      }
    });

    if (sent) {
      await pool.query(`
        INSERT INTO telegram_digest_state (key, last_sent_at)
        VALUES ('hourly_status_report', NOW())
        ON CONFLICT (key) DO UPDATE SET last_sent_at=NOW()
      `);
      console.log(`[TelegramDigest] sent by ${source} at ${nowWib()} WIB`);
      return true;
    }

    console.warn(`[TelegramDigest] failed to send by ${source}. Check Telegram token/chat_id/runtime settings.`);
    return false;
  } catch (err) {
    console.error(`[TelegramDigest] error from ${source}:`, err.message);
    return false;
  } finally {
    digestRunning = false;
  }
}

async function runChecks() {
  if (running) return;
  running = true;

  try {
    await ensureReasonTypeColumn();

    const retryLimit = getRetryLimit();
    const { rows: domains } = await pool.query("SELECT * FROM domains WHERE is_active = TRUE ORDER BY id ASC");
    const { rows: proxies } = await pool.query("SELECT * FROM proxies WHERE is_active = TRUE ORDER BY id ASC");
    const nodes = await getActiveNodes();

    for (const domain of domains) {
      const results = [];

      const directResult = await checkDomain(domain.domain, { type: "direct", provider_name: "Direct" });
      results.push(directResult);

      for (const proxy of proxies) {
        const proxyResult = await checkDomain(domain.domain, { type: "proxy", provider_name: proxy.provider_name, proxy });
        results.push(proxyResult);
      }

      for (const node of nodes) {
        const nodeResult = await checkViaNode(domain.domain, node);
        results.push(nodeResult);
      }

      await maybeAddProviderRegistryResult(domain, results);

      for (const r of results) {
        await pool.query(
          `INSERT INTO check_results
          (domain_id, checker_type, provider_name, status, http_status, final_url, dns_result, latency_ms, reason, reason_type)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [domain.id, r.checker_type, r.provider_name, r.status, r.http_status, r.final_url, r.dns_result, r.latency_ms, r.reason, classifyReasonType(r)]
        );
      }

      const domainResults = results.filter((r) => !isNodeTimeout(r));
      const effectiveResults = domainResults.length ? domainResults : results;

      const newStatus = calculateGlobalStatus(effectiveResults);
      const oldStatus = domain.global_status || "unknown";

      if (normalizeStatus(newStatus) !== "blocked") {
        await clearAcknowledged(domain.id);
      }

      const decision = decide(domain.id, oldStatus, newStatus, retryLimit);

      if (!decision.apply) {
        await pool.query(
          "UPDATE domains SET last_status=$1, last_checked_at=NOW() WHERE id=$2",
          [decision.value ? `pending:${decision.value}:${decision.count}/${decision.max}` : oldStatus, domain.id]
        );
        continue;
      }

      await pool.query(
        "UPDATE domains SET last_status=$1, global_status=$2, last_checked_at=NOW() WHERE id=$3",
        [oldStatus, newStatus, domain.id]
      );

      if (oldStatus !== newStatus) {
        const worst =
          effectiveResults.find((r) => r.status === "blocked") ||
          effectiveResults.find((r) => r.status === "warning") ||
          effectiveResults[0];

        let sent = false;
        let message = `SILENT STATUS CHANGE\n\nDomain: ${domain.domain}\nOld: ${oldStatus}\nNew: ${newStatus}\nChecker: ${worst.provider_name}\nReason Type: ${reasonTypeLabel(classifyReasonType(worst))}\nReason: ${worst.reason}\nTime: ${nowWib()} WIB`;

        if (isImportantTransition(oldStatus, newStatus, worst) && !(await sentRecently(domain.id, newStatus)) && !(normalizeStatus(newStatus) === "blocked" && await isAcknowledged(domain.id))) {
          const icon = iconFor(newStatus, worst.final_url);
          const title = normalizeStatus(newStatus) === "blocked"
            ? `${icon} BLOCKED STATUS CHANGE CONFIRMED`
            : `${icon} WARNING STATUS CHANGE CONFIRMED`;

          const redirectLine = normalizeStatus(newStatus) === "blocked" && worst.final_url
            ? `\nRedirected: ➡️ ${worst.final_url}`
            : "";

          message = `${title}\n\nDomain: ${domain.domain}\nOld: ${oldStatus}\nNew: ${newStatus}\nConfirmed: ${retryLimit} checks\nChecker: ${worst.provider_name}\nReason: ${worst.reason}\nFinal URL: ${worst.final_url || "-"}${redirectLine}\nTime: ${nowWib()} WIB`;

          const telegramExtra = normalizeStatus(newStatus) === "blocked"
            ? {
                reply_markup: {
                  inline_keyboard: [[
                    { text: "✅ Noticed", callback_data: `noticed:${domain.id}:blocked` }
                  ]]
                }
              }
            : {};

          sent = await sendTelegram(message, telegramExtra);
        }

        await pool.query(
          "INSERT INTO alerts (domain_id, old_status, new_status, message, sent_to_telegram) VALUES ($1,$2,$3,$4,$5)",
          [domain.id, oldStatus, newStatus, message, sent]
        );
      }
    }

    await sendHourlyDigestIfDue("runChecks");
  } catch (err) {
    console.error("Scheduler error:", err);
  } finally {
    running = false;
  }
}

function startDigestWatchdog() {
  if (digestWatchdogStarted) return;
  digestWatchdogStarted = true;

  const minutes = Number.isFinite(DIGEST_WATCHDOG_MINUTES) && DIGEST_WATCHDOG_MINUTES > 0 ? DIGEST_WATCHDOG_MINUTES : 5;
  const intervalMs = minutes * 60 * 1000;

  console.log(`Telegram digest watchdog started: every ${minutes} minutes, digest interval ${DIGEST_INTERVAL_MINUTES} minutes`);

  setTimeout(() => {
    sendHourlyDigestIfDue("startup-watchdog").catch((err) => console.error("Telegram digest startup watchdog error:", err.message));
  }, 30 * 1000);

  setInterval(() => {
    sendHourlyDigestIfDue("interval-watchdog").catch((err) => console.error("Telegram digest interval watchdog error:", err.message));
  }, intervalMs);
}

function startScheduler() {
  const cronExpr = getCronExpr();
  cron.schedule(cronExpr, runChecks);
  startDigestWatchdog();
  console.log("Scheduler started:", cronExpr, "confirmations:", getRetryLimit());
}

module.exports = { startScheduler, runChecks, maybeAddProviderRegistryResult, sendHourlyDigestIfDue };

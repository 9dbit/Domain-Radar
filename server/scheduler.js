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

const ALERT_COOLDOWN_MINUTES = Number(process.env.ALERT_COOLDOWN_MINUTES || 60);
const DIGEST_INTERVAL_MINUTES = Number(process.env.DIGEST_INTERVAL_MINUTES || 60);
const DIGEST_LIMIT = Number(process.env.TELEGRAM_DIGEST_LIMIT || 120);
const TRUSTPOSITIF_ON_DIRECT_WARNING = String(process.env.TRUSTPOSITIF_ON_DIRECT_WARNING || "true").toLowerCase() !== "false";

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
  if (normalizeStatus(domain.global_status) === "blocked") {
    return { check: false, reason: "domain already blocked" };
  }

  if (hasProviderNodeWarning(results)) {
    return { check: true, reason: "provider node warning" };
  }

  if (TRUSTPOSITIF_ON_DIRECT_WARNING && hasDirectWarning(results)) {
    return { check: true, reason: "direct warning" };
  }

  return { check: false, reason: "no provider-node/direct warning" };
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

async function latestFinalUrlMap() {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (domain_id) domain_id, final_url
    FROM check_results
    WHERE COALESCE(final_url, '') <> ''
    ORDER BY domain_id, checked_at DESC
  `);

  const map = new Map();
  for (const row of rows) map.set(row.domain_id, row.final_url || "");
  return map;
}

function iconFor(status, finalUrl = "") {
  const value = normalizeStatus(status);
  if (value === "working") return "✅";
  if (value === "warning") return "⚠️";
  if (value === "blocked" && finalUrl) return "➡️";
  if (value === "blocked") return "❗";
  return "•";
}

function formatDomainList(title, rows, finalUrlMap) {
  if (!rows.length) return `${title}\n-`;

  const lines = rows.slice(0, DIGEST_LIMIT).map((row) => {
    const finalUrl = finalUrlMap.get(row.id) || "";
    const redirect = normalizeStatus(row.global_status) === "blocked" && finalUrl ? ` → ${finalUrl}` : "";
    return `${iconFor(row.global_status, finalUrl)} ${row.domain}${redirect}`;
  });

  if (rows.length > DIGEST_LIMIT) {
    lines.push(`...and ${rows.length - DIGEST_LIMIT} more`);
  }

  return `${title}\n${lines.join("\n")}`;
}

async function sendHourlyDigestIfDue() {
  await ensureDigestTable();

  const { rows: state } = await pool.query(
    "SELECT last_sent_at FROM telegram_digest_state WHERE key='hourly_status_report' LIMIT 1"
  );

  const lastSentAt = state[0]?.last_sent_at ? new Date(state[0].last_sent_at).getTime() : 0;
  const intervalMs = DIGEST_INTERVAL_MINUTES * 60 * 1000;

  if (lastSentAt && Date.now() - lastSentAt < intervalMs) return;

  const { rows: domains } = await pool.query(
    "SELECT id, domain, global_status FROM domains WHERE is_active=true ORDER BY domain ASC"
  );

  const finalUrlMap = await latestFinalUrlMap();

  const normal = domains.filter((d) => normalizeStatus(d.global_status) === "working");
  const warning = domains.filter((d) => normalizeStatus(d.global_status) === "warning");
  const blocked = domains.filter((d) => normalizeStatus(d.global_status) === "blocked");
  const redirected = blocked.filter((d) => finalUrlMap.get(d.id));

  const message = [
    "DOMAIN RADAR HOURLY REPORT",
    "",
    `Time: ${nowWib()} WIB`,
    `Total: ${domains.length}`,
    `✅ Normal: ${normal.length}`,
    `⚠️ Warning: ${warning.length}`,
    `❗ Blocked: ${blocked.length - redirected.length}`,
    `➡️ Blocked + redirected: ${redirected.length}`,
    "",
    formatDomainList("NORMAL", normal, finalUrlMap),
    "",
    formatDomainList("WARNING", warning, finalUrlMap),
    "",
    formatDomainList("BLOCKED / REDIRECTED", blocked, finalUrlMap)
  ].join("\n");

  const sent = await sendTelegram(message);

  if (sent) {
    await pool.query(`
      INSERT INTO telegram_digest_state (key, last_sent_at)
      VALUES ('hourly_status_report', NOW())
      ON CONFLICT (key) DO UPDATE SET last_sent_at=NOW()
    `);
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

    await sendHourlyDigestIfDue();
  } catch (err) {
    console.error("Scheduler error:", err);
  } finally {
    running = false;
  }
}

function startScheduler() {
  const cronExpr = getCronExpr();
  cron.schedule(cronExpr, runChecks);
  console.log("Scheduler started:", cronExpr, "confirmations:", getRetryLimit());
}

module.exports = { startScheduler, runChecks };

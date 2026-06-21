const cron = require("node-cron");
const { pool } = require("./db");
const { checkDomain, calculateGlobalStatus } = require("./checker");
const { sendTelegram } = require("./telegram");

let running = false;

async function runChecks() {
  if (running) return;
  running = true;

  try {
    const { rows: domains } = await pool.query("SELECT * FROM domains WHERE is_active = TRUE ORDER BY id ASC");
    const { rows: proxies } = await pool.query("SELECT * FROM proxies WHERE is_active = TRUE ORDER BY id ASC");

    for (const domain of domains) {
      const results = [];

      const directResult = await checkDomain(domain.domain, {
        type: "direct",
        provider_name: "Direct"
      });
      results.push(directResult);

      for (const proxy of proxies) {
        const proxyResult = await checkDomain(domain.domain, {
          type: "proxy",
          provider_name: proxy.provider_name,
          proxy
        });
        results.push(proxyResult);
      }

      for (const r of results) {
        await pool.query(
          `INSERT INTO check_results 
          (domain_id, checker_type, provider_name, status, http_status, final_url, dns_result, latency_ms, reason)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [domain.id, r.checker_type, r.provider_name, r.status, r.http_status, r.final_url, r.dns_result, r.latency_ms, r.reason]
        );
      }

      const newStatus = calculateGlobalStatus(results);
      const oldStatus = domain.global_status || "unknown";

      await pool.query(
        "UPDATE domains SET last_status=$1, global_status=$2, last_checked_at=NOW() WHERE id=$3",
        [oldStatus, newStatus, domain.id]
      );

      if (oldStatus !== newStatus) {
        const worst = results.find(r => r.status === "blocked") || results.find(r => r.status === "warning") || results[0];
        const icon = newStatus === "blocked" ? "ALERT" : newStatus === "warning" ? "WARNING" : "RECOVERED";
        const message = `${icon} DOMAIN STATUS CHANGED\n\nDomain: ${domain.domain}\nOld: ${oldStatus}\nNew: ${newStatus}\nChecker: ${worst.provider_name}\nReason: ${worst.reason}\nFinal URL: ${worst.final_url || "-"}\nTime: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`;

        const sent = await sendTelegram(message);

        await pool.query(
          "INSERT INTO alerts (domain_id, old_status, new_status, message, sent_to_telegram) VALUES ($1,$2,$3,$4,$5)",
          [domain.id, oldStatus, newStatus, message, sent]
        );
      }
    }
  } catch (err) {
    console.error("Scheduler error:", err);
  } finally {
    running = false;
  }
}

function startScheduler() {
  const interval = Number(process.env.CHECK_INTERVAL_SECONDS || 60);
  const cronExpr = interval <= 60 ? "* * * * *" : `*/${Math.ceil(interval / 60)} * * * *`;
  cron.schedule(cronExpr, runChecks);
  console.log("Scheduler started:", cronExpr);
}

module.exports = { startScheduler, runChecks };

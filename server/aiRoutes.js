const express = require("express");
const { pool } = require("./db");
const { generateIncidentAdvice, generateHourlySummary } = require("./aiAdvisor");

const router = express.Router();

function normalizeStatus(status) {
  const value = String(status || "unknown").toLowerCase().trim();
  if (["normal", "ok", "online", "success", "working"].includes(value)) return "working";
  if (["warn", "warning", "timeout", "error"].includes(value)) return "warning";
  if (["block", "blocked", "down", "offline"].includes(value)) return "blocked";
  return value || "unknown";
}

async function latestFinalUrlMap() {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (domain_id) domain_id, final_url
    FROM check_results
    WHERE COALESCE(final_url, '') <> ''
    ORDER BY domain_id, checked_at DESC
  `);
  return new Map(rows.map((row) => [row.domain_id, row.final_url || ""]));
}

router.get("/summary", async (req, res, next) => {
  try {
    const { rows: domains } = await pool.query(
      "SELECT id, domain, global_status FROM domains WHERE is_active=true ORDER BY domain ASC"
    );

    const finalMap = await latestFinalUrlMap();
    const normal = domains.filter((d) => normalizeStatus(d.global_status) === "working");
    const warning = domains.filter((d) => normalizeStatus(d.global_status) === "warning");
    const blocked = domains.filter((d) => normalizeStatus(d.global_status) === "blocked");
    const redirected = blocked.filter((d) => finalMap.get(d.id));
    const blockedOnly = blocked.filter((d) => !finalMap.get(d.id));
    const summary = generateHourlySummary({ domains, normal, warning, blockedOnly, redirected });

    res.json({
      ok: true,
      summary,
      counts: {
        total: domains.length,
        normal: normal.length,
        warning: warning.length,
        blocked: blockedOnly.length,
        blocked_redirected: redirected.length
      },
      samples: {
        warning: warning.slice(0, 20).map((d) => d.domain),
        blocked: blockedOnly.slice(0, 20).map((d) => d.domain),
        blocked_redirected: redirected.slice(0, 20).map((d) => d.domain)
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get("/domain/:id", async (req, res, next) => {
  try {
    const { rows: domainRows } = await pool.query(
      "SELECT * FROM domains WHERE id=$1 LIMIT 1",
      [req.params.id]
    );
    const domain = domainRows[0];
    if (!domain) return res.status(404).json({ error: "Domain not found" });

    const { rows: results } = await pool.query(
      `SELECT * FROM check_results WHERE domain_id=$1 ORDER BY checked_at DESC LIMIT 20`,
      [domain.id]
    );

    const worst =
      results.find((r) => normalizeStatus(r.status) === "blocked") ||
      results.find((r) => normalizeStatus(r.status) === "warning") ||
      results[0] ||
      {};

    const advice = generateIncidentAdvice({
      domain: domain.domain,
      oldStatus: domain.last_status || "unknown",
      newStatus: domain.global_status || "unknown",
      confirmedChecks: results.length,
      worst,
      results
    });

    res.json({
      ok: true,
      domain: {
        id: domain.id,
        domain: domain.domain,
        status: domain.global_status,
        last_status: domain.last_status,
        last_checked_at: domain.last_checked_at
      },
      advice,
      worst,
      recent_results: results
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

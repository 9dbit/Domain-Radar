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

function projectSeoAdvice(projectName, rows) {
  const total = rows.length;
  const normal = rows.filter((d) => normalizeStatus(d.global_status) === "working");
  const warning = rows.filter((d) => normalizeStatus(d.global_status) === "warning");
  const blocked = rows.filter((d) => normalizeStatus(d.global_status) === "blocked");
  const score = total ? Math.max(0, Math.round((normal.length / total) * 100 - warning.length * 3 - blocked.length * 12)) : 0;
  const tier = score >= 80 ? "STRONG" : score >= 55 ? "WATCH" : "RISK";

  const actions = [];
  if (blocked.length) actions.push("Move blocked domains into quarantine and exclude them from active SEO linking.");
  if (warning.length) actions.push("Audit warning domains by DNS, SSL, HTTP, redirect, and provider-node reason before using them as support pages.");
  if (normal.length) actions.push("Use normal domains as the active whitelist pool for internal linking and content distribution.");
  if (!actions.length) actions.push("Add healthy domains before running SEO distribution for this project.");

  return {
    project_name: projectName,
    score,
    tier,
    counts: { total, normal: normal.length, warning: warning.length, blocked: blocked.length },
    summary: `${projectName}: ${tier} SEO health. ${normal.length}/${total} normal, ${warning.length} warning, ${blocked.length} blocked.`,
    action: actions.join(" "),
    normal_sample: normal.slice(0, 10).map((d) => d.domain),
    warning_sample: warning.slice(0, 10).map((d) => d.domain),
    blocked_sample: blocked.slice(0, 10).map((d) => d.domain)
  };
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

router.get("/projects/seo", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, domain, COALESCE(NULLIF(project_name,''), 'No Project') AS project_name, global_status, last_status, last_checked_at FROM domains WHERE is_active=true ORDER BY project_name ASC, domain ASC"
    );
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.project_name)) groups.set(row.project_name, []);
      groups.get(row.project_name).push(row);
    }
    const projects = Array.from(groups.entries()).map(([name, list]) => projectSeoAdvice(name, list));
    res.json({ ok: true, generated_by: "Domain Radar AI", projects });
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

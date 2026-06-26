const express = require("express");
const { pool } = require("./db");

const router = express.Router();

router.get("/trustpositif", async (req, res) => {
  const status = String(req.query.status || "all");
  const where = status === "blocked"
    ? "AND latest.status='blocked'"
    : status === "working"
      ? "AND latest.status='working'"
      : "";

  const { rows } = await pool.query(`
    WITH latest AS (
      SELECT DISTINCT ON (r.domain_id)
        r.domain_id,
        r.status,
        r.reason,
        r.reason_type,
        r.checked_at,
        d.domain,
        d.project_name,
        d.global_status,
        n.noticed_at,
        n.telegram_username
      FROM check_results r
      JOIN domains d ON d.id = r.domain_id
      LEFT JOIN telegram_notices n ON n.domain_id = d.id
      WHERE r.provider_name = 'TrustPositif'
      ORDER BY r.domain_id, r.checked_at DESC
    )
    SELECT * FROM latest
    WHERE 1=1 ${where}
    ORDER BY checked_at DESC
    LIMIT 300
  `);

  const counts = rows.reduce((acc, row) => {
    acc.total += 1;
    acc[row.status] = (acc[row.status] || 0) + 1;
    if (row.noticed_at) acc.noticed += 1;
    return acc;
  }, { total: 0, blocked: 0, working: 0, noticed: 0 });

  res.json({ rows, counts });
});

router.get("/notices", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT n.*, d.domain, d.project_name, d.global_status
    FROM telegram_notices n
    LEFT JOIN domains d ON d.id = n.domain_id
    ORDER BY n.noticed_at DESC
    LIMIT 300
  `);
  res.json(rows);
});

router.delete("/notices/:domainId", async (req, res) => {
  await pool.query("DELETE FROM telegram_notices WHERE domain_id=$1", [req.params.domainId]);
  res.json({ ok: true });
});

module.exports = router;

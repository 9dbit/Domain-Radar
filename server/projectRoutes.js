const express = require("express");
const { pool } = require("./db");
const { requirePlanQuota } = require("./planQuota");

const router = express.Router();

function currentUser(req) {
  return req.user || { userId: req.session?.userId, role: req.session?.role };
}

function isSuperadmin(req) {
  return currentUser(req)?.role === "superadmin";
}

async function ensureProjectTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      user_id UUID REFERENCES users(id),
      name TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)");
  await pool.query("ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_name_key");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_user_name ON projects(user_id, name)");
}

router.get("/", async (req, res, next) => {
  try {
    await ensureProjectTable();
    const user = currentUser(req);
    const params = isSuperadmin(req) ? [] : [user.userId];
    const projectFilter = isSuperadmin(req) ? "TRUE" : "p.user_id=$1";
    const domainFilter = isSuperadmin(req) ? "TRUE" : "d.user_id=$1";
    const joinFilter = isSuperadmin(req) ? "d.project_name = p.name" : "d.project_name = p.name AND d.user_id=$1";

    const sql = `
      WITH scoped_projects AS (SELECT * FROM projects p WHERE ${projectFilter}),
           scoped_domains AS (SELECT * FROM domains d WHERE ${domainFilter})
      SELECT
        COALESCE(p.name, d.project_name, 'No Project') AS project_name,
        MIN(p.id) AS id,
        COALESCE(MAX(p.notes), '') AS notes,
        COUNT(d.id)::int AS total,
        COUNT(d.id) FILTER (WHERE d.global_status='working')::int AS working,
        COUNT(d.id) FILTER (WHERE d.global_status='warning')::int AS warning,
        COUNT(d.id) FILTER (WHERE d.global_status='blocked')::int AS blocked
      FROM scoped_projects p
      FULL OUTER JOIN scoped_domains d ON ${joinFilter}
      GROUP BY COALESCE(p.name, d.project_name, 'No Project')
      ORDER BY total DESC, project_name ASC
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/", requirePlanQuota("projects"), async (req, res, next) => {
  try {
    await ensureProjectTable();
    const user = currentUser(req);
    if (user?.role === "demo") return res.status(403).json({ error: "Demo account is read-only" });
    const name = String(req.body.name || "").trim();
    const notes = String(req.body.notes || "").trim();
    if (!name) return res.status(400).json({ error: "Project name required" });
    const { rows } = await pool.query(
      `INSERT INTO projects (user_id, name, notes) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, name) DO UPDATE SET notes=EXCLUDED.notes
       RETURNING *`,
      [user.userId, name, notes]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete("/:name", async (req, res, next) => {
  try {
    await ensureProjectTable();
    const user = currentUser(req);
    if (user?.role === "demo") return res.status(403).json({ error: "Demo account is read-only" });
    const name = String(req.params.name || "").trim();
    if (isSuperadmin(req)) {
      await pool.query("DELETE FROM projects WHERE name=$1", [name]);
    } else {
      await pool.query("DELETE FROM projects WHERE name=$1 AND user_id=$2", [name, user.userId]);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

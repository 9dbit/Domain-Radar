const express = require("express");
const { pool } = require("./db");

const router = express.Router();

async function ensureProjectTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      notes TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

router.get("/", async (req, res, next) => {
  try {
    await ensureProjectTable();
    const { rows } = await pool.query(`
      SELECT
        COALESCE(p.name, d.project_name, 'No Project') AS project_name,
        MIN(p.id) AS id,
        COALESCE(MAX(p.notes), '') AS notes,
        COUNT(d.id)::int AS total,
        COUNT(d.id) FILTER (WHERE d.global_status='working')::int AS working,
        COUNT(d.id) FILTER (WHERE d.global_status='warning')::int AS warning,
        COUNT(d.id) FILTER (WHERE d.global_status='blocked')::int AS blocked
      FROM projects p
      FULL OUTER JOIN domains d ON d.project_name = p.name
      GROUP BY COALESCE(p.name, d.project_name, 'No Project')
      ORDER BY total DESC, project_name ASC
    `);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    await ensureProjectTable();
    const name = String(req.body.name || "").trim();
    const notes = String(req.body.notes || "").trim();
    if (!name) return res.status(400).json({ error: "Project name required" });
    const { rows } = await pool.query(
      `INSERT INTO projects (name, notes) VALUES ($1,$2)
       ON CONFLICT (name) DO UPDATE SET notes=EXCLUDED.notes
       RETURNING *`,
      [name, notes]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete("/:name", async (req, res, next) => {
  try {
    await ensureProjectTable();
    const name = String(req.params.name || "").trim();
    await pool.query("DELETE FROM projects WHERE name=$1", [name]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

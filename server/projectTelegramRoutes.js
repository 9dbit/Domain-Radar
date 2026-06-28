const express = require("express");
const { pool } = require("./db");

const router = express.Router();

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_telegram_groups (
      id SERIAL PRIMARY KEY,
      project_name TEXT UNIQUE NOT NULL,
      telegram_chat_id TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

router.get("/", async (req, res, next) => {
  try {
    await ensureTable();
    const { rows } = await pool.query("SELECT * FROM project_telegram_groups ORDER BY project_name ASC");
    res.json(rows);
  } catch (err) { next(err); }
});

router.post("/", async (req, res, next) => {
  try {
    await ensureTable();
    const project_name = String(req.body.project_name || "").trim();
    const telegram_chat_id = String(req.body.telegram_chat_id || "").trim();
    if (!project_name || !telegram_chat_id) return res.status(400).json({ error: "project_name and telegram_chat_id required" });
    const { rows } = await pool.query(
      `INSERT INTO project_telegram_groups (project_name, telegram_chat_id)
       VALUES ($1, $2)
       ON CONFLICT (project_name) DO UPDATE SET telegram_chat_id=EXCLUDED.telegram_chat_id
       RETURNING *`,
      [project_name, telegram_chat_id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete("/:projectName", async (req, res, next) => {
  try {
    await ensureTable();
    await pool.query("DELETE FROM project_telegram_groups WHERE project_name=$1", [req.params.projectName]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

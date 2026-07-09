const express = require("express");
const { pool } = require("./db");

const router = express.Router();

function currentUser(req) {
  return req.user || { userId: req.session?.userId, role: req.session?.role };
}

function isSuperadmin(req) {
  return currentUser(req)?.role === "superadmin";
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_telegram_groups (
      id SERIAL PRIMARY KEY,
      user_id UUID REFERENCES users(id),
      project_name TEXT NOT NULL,
      telegram_chat_id TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query("ALTER TABLE project_telegram_groups ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)");
  await pool.query("ALTER TABLE project_telegram_groups DROP CONSTRAINT IF EXISTS project_telegram_groups_project_name_key");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_project_telegram_user_project ON project_telegram_groups(user_id, project_name)");
}

router.get("/", async (req, res, next) => {
  try {
    await ensureTable();
    if (isSuperadmin(req)) {
      const { rows } = await pool.query("SELECT * FROM project_telegram_groups ORDER BY project_name ASC");
      return res.json(rows);
    }
    const { rows } = await pool.query("SELECT * FROM project_telegram_groups WHERE user_id=$1 ORDER BY project_name ASC", [currentUser(req).userId]);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post("/", async (req, res, next) => {
  try {
    await ensureTable();
    const user = currentUser(req);
    if (user?.role === "demo") return res.status(403).json({ error: "Demo account is read-only" });
    const project_name = String(req.body.project_name || "").trim();
    const telegram_chat_id = String(req.body.telegram_chat_id || "").trim();
    if (!project_name || !telegram_chat_id) return res.status(400).json({ error: "project_name and telegram_chat_id required" });
    const { rows } = await pool.query(
      `INSERT INTO project_telegram_groups (user_id, project_name, telegram_chat_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, project_name) DO UPDATE SET telegram_chat_id=EXCLUDED.telegram_chat_id
       RETURNING *`,
      [user.userId, project_name, telegram_chat_id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

router.delete("/:projectName", async (req, res, next) => {
  try {
    await ensureTable();
    const user = currentUser(req);
    if (user?.role === "demo") return res.status(403).json({ error: "Demo account is read-only" });
    if (isSuperadmin(req)) {
      await pool.query("DELETE FROM project_telegram_groups WHERE project_name=$1", [req.params.projectName]);
    } else {
      await pool.query("DELETE FROM project_telegram_groups WHERE project_name=$1 AND user_id=$2", [req.params.projectName, user.userId]);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

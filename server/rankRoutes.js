const express = require("express");
const axios = require("axios");
const { pool } = require("./db");
const { normalizeDomain } = require("./checker");

const router = express.Router();

async function ensureRankTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rank_keywords (
      id SERIAL PRIMARY KEY,
      project_name TEXT DEFAULT '',
      domain TEXT NOT NULL,
      keyword TEXT NOT NULL,
      target_url TEXT DEFAULT '',
      is_active BOOLEAN DEFAULT TRUE,
      last_position INTEGER,
      last_page INTEGER,
      last_checked_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(domain, keyword)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rank_results (
      id SERIAL PRIMARY KEY,
      keyword_id INTEGER REFERENCES rank_keywords(id) ON DELETE CASCADE,
      keyword TEXT NOT NULL,
      domain TEXT NOT NULL,
      position INTEGER,
      page INTEGER,
      matched_url TEXT,
      source TEXT DEFAULT 'google_custom_search',
      checked_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch (_) {
    return "";
  }
}

function domainMatches(link, domain) {
  const host = hostFromUrl(link);
  const clean = normalizeDomain(domain).replace(/^www\./, "");
  return host === clean || host.endsWith(`.${clean}`);
}

async function checkKeyword(row) {
  const key = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;
  if (!key || !cx) {
    throw new Error("Missing GOOGLE_SEARCH_API_KEY or GOOGLE_SEARCH_CX");
  }

  let found = { position: null, page: null, matched_url: "" };
  const maxPages = Number(process.env.RANK_MAX_PAGES || 10);

  for (let page = 0; page < maxPages; page += 1) {
    const start = page * 10 + 1;
    const { data } = await axios.get("https://www.googleapis.com/customsearch/v1", {
      timeout: 20000,
      params: { key, cx, q: row.keyword, start, num: 10 }
    });

    const items = Array.isArray(data.items) ? data.items : [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (domainMatches(item.link, row.domain)) {
        const position = start + i;
        found = { position, page: Math.ceil(position / 10), matched_url: item.link || "" };
        page = maxPages;
        break;
      }
    }

    if (items.length < 10) break;
  }

  await pool.query(
    `INSERT INTO rank_results (keyword_id, keyword, domain, position, page, matched_url)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [row.id, row.keyword, row.domain, found.position, found.page, found.matched_url]
  );

  await pool.query(
    "UPDATE rank_keywords SET last_position=$1, last_page=$2, last_checked_at=NOW() WHERE id=$3",
    [found.position, found.page, row.id]
  );

  return found;
}

router.get("/keywords", async (req, res, next) => {
  try {
    await ensureRankTables();
    const { rows } = await pool.query("SELECT * FROM rank_keywords ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/keywords", async (req, res, next) => {
  try {
    await ensureRankTables();
    const domain = normalizeDomain(req.body.domain || "");
    const keyword = String(req.body.keyword || "").trim();
    const project = String(req.body.project_name || "").trim();
    const targetUrl = String(req.body.target_url || "").trim();
    if (!domain || !keyword) return res.status(400).json({ error: "Domain and keyword required" });
    const { rows } = await pool.query(
      `INSERT INTO rank_keywords (project_name, domain, keyword, target_url)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (domain, keyword) DO UPDATE SET project_name=EXCLUDED.project_name, target_url=EXCLUDED.target_url
       RETURNING *`,
      [project, domain, keyword, targetUrl]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete("/keywords/:id", async (req, res, next) => {
  try {
    await ensureRankTables();
    await pool.query("DELETE FROM rank_keywords WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/results", async (req, res, next) => {
  try {
    await ensureRankTables();
    const { rows } = await pool.query("SELECT * FROM rank_results ORDER BY checked_at DESC LIMIT 300");
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/check/:id", async (req, res, next) => {
  try {
    await ensureRankTables();
    const { rows } = await pool.query("SELECT * FROM rank_keywords WHERE id=$1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Keyword not found" });
    const result = await checkKeyword(rows[0]);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

router.post("/check-all", async (req, res, next) => {
  try {
    await ensureRankTables();
    const { rows } = await pool.query("SELECT * FROM rank_keywords WHERE is_active=true ORDER BY id DESC LIMIT 50");
    const checked = [];
    for (const row of rows) {
      try {
        checked.push({ id: row.id, keyword: row.keyword, domain: row.domain, ...(await checkKeyword(row)) });
      } catch (err) {
        checked.push({ id: row.id, keyword: row.keyword, domain: row.domain, error: err.message });
      }
    }
    res.json({ ok: true, checked });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

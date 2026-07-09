const express = require("express");
const axios = require("axios");
const dns = require("dns").promises;
const { pool } = require("./db");
const { normalizeDomain } = require("./checker");
const { sendTelegram, sendTelegramToProject } = require("./telegram");

const router = express.Router();

const DEFAULT_ALLOWED_EXTERNAL = ["medium.com", "youtube.com", "facebook.com", "instagram.com", "tiktok.com", "reddit.com", "behance.net", "github.com", "github.io", "linktr.ee", "heylink.me", "bit.ly", "x.com", "twitter.com"];

function currentUser(req) { return req.user || { userId: req.session?.userId, role: req.session?.role }; }
function isSuperadmin(req) { return currentUser(req)?.role === "superadmin"; }
function userParams(req) { return isSuperadmin(req) ? { where: "TRUE", params: [] } : { where: "user_id=$1", params: [currentUser(req).userId] }; }

async function ensureRankTables() {
  await pool.query(`CREATE TABLE IF NOT EXISTS rank_keywords (id SERIAL PRIMARY KEY, user_id UUID REFERENCES users(id), project_name TEXT DEFAULT '', domain TEXT NOT NULL, keyword TEXT NOT NULL, target_url TEXT DEFAULT '', is_active BOOLEAN DEFAULT TRUE, last_position INTEGER, last_page INTEGER, last_checked_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS rank_results (id SERIAL PRIMARY KEY, keyword_id INTEGER, keyword TEXT NOT NULL, domain TEXT NOT NULL, position INTEGER, page INTEGER, matched_url TEXT, source TEXT DEFAULT 'google_custom_search', checked_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS rank_keyword_groups (id SERIAL PRIMARY KEY, user_id UUID REFERENCES users(id), project_name TEXT DEFAULT '', keyword TEXT NOT NULL, keyword_lc TEXT NOT NULL, is_active BOOLEAN DEFAULT TRUE, last_checked_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS rank_keyword_domains (id SERIAL PRIMARY KEY, group_id INTEGER REFERENCES rank_keyword_groups(id) ON DELETE CASCADE, domain TEXT NOT NULL, target_url TEXT DEFAULT '', is_whitelisted BOOLEAN DEFAULT TRUE, last_position INTEGER, last_page INTEGER, last_matched_url TEXT, last_status TEXT DEFAULT 'pending', last_checked_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW(), UNIQUE(group_id, domain))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS rank_scan_results (id SERIAL PRIMARY KEY, group_id INTEGER REFERENCES rank_keyword_groups(id) ON DELETE CASCADE, keyword TEXT NOT NULL, position INTEGER, page INTEGER, title TEXT, link TEXT, snippet TEXT, host TEXT, classification TEXT DEFAULT 'unknown', reason TEXT DEFAULT '', checked_at TIMESTAMP DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS domain_intel_cache (domain TEXT PRIMARY KEY, ip TEXT, nameservers JSONB DEFAULT '[]'::jsonb, registrar TEXT DEFAULT '', abuse_email TEXT DEFAULT '', network_name TEXT DEFAULT '', asn TEXT DEFAULT '', report_url TEXT DEFAULT '', checked_at TIMESTAMP DEFAULT NOW(), raw JSONB DEFAULT '{}'::jsonb)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS rank_suspicious_seen (id SERIAL PRIMARY KEY, group_id INTEGER REFERENCES rank_keyword_groups(id) ON DELETE CASCADE, host TEXT NOT NULL, first_seen_at TIMESTAMP DEFAULT NOW(), last_seen_at TIMESTAMP DEFAULT NOW(), last_position INTEGER, last_page INTEGER, UNIQUE(group_id, host))`);

  await pool.query("ALTER TABLE rank_keywords ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)");
  await pool.query("ALTER TABLE rank_keyword_groups ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)");
  await pool.query("ALTER TABLE rank_keywords DROP CONSTRAINT IF EXISTS rank_keywords_domain_keyword_key");
  await pool.query("ALTER TABLE rank_keyword_groups DROP CONSTRAINT IF EXISTS rank_keyword_groups_keyword_lc_key");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_rank_keywords_user_domain_keyword ON rank_keywords(user_id, domain, keyword)");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_rank_groups_user_keyword ON rank_keyword_groups(user_id, keyword_lc)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_rank_groups_user_id ON rank_keyword_groups(user_id)");
}

function hostFromUrl(url) { try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch (_) { return ""; } }
function domainMatches(linkOrHost, domain) { const raw = String(linkOrHost || ""); const host = raw.includes("/") ? hostFromUrl(raw) : raw.replace(/^www\./, "").toLowerCase(); const clean = normalizeDomain(domain).replace(/^www\./, ""); return host === clean || host.endsWith(`.${clean}`); }
function parseDomainList(value) { return String(value || "").split(/[\n,;\t ]+/).map((x) => normalizeDomain(x.trim())).filter(Boolean); }
function allowedExternalDomains() { const envList = String(process.env.RANK_ALLOWED_EXTERNAL_DOMAINS || "").split(/[,\n;]/).map((x) => normalizeDomain(x.trim())).filter(Boolean); return [...new Set([...DEFAULT_ALLOWED_EXTERNAL, ...envList])]; }
function keywordTokens(keyword) { return String(keyword || "").toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 3); }

function classifyResult(item, whitelistDomains, allowedExternal) {
  const host = hostFromUrl(item.link || "");
  const title = String(item.title || "").toLowerCase();
  const snippet = String(item.snippet || "").toLowerCase();
  const link = String(item.link || "").toLowerCase();
  const tokens = keywordTokens(item.keyword || "");
  if (!host) return { classification: "unknown", reason: "No host detected" };
  if (whitelistDomains.some((d) => domainMatches(host, d))) return { classification: "whitelisted", reason: "Matched monitored whitelist domain" };
  if (allowedExternal.some((d) => domainMatches(host, d))) return { classification: "external_safe", reason: "Matched allowed external platform" };
  const brandSignal = tokens.some((t) => host.includes(t) || title.includes(t) || snippet.includes(t) || link.includes(t));
  if (brandSignal) return { classification: "suspicious", reason: "Non-whitelisted result contains brand/keyword signal" };
  return { classification: "unknown", reason: "Non-whitelisted result" };
}

async function getKeywordGroup(id, req = null) {
  let group;
  if (req && !isSuperadmin(req)) group = (await pool.query("SELECT * FROM rank_keyword_groups WHERE id=$1 AND user_id=$2", [id, currentUser(req).userId])).rows[0];
  else group = (await pool.query("SELECT * FROM rank_keyword_groups WHERE id=$1", [id])).rows[0];
  if (!group) return null;
  const domains = (await pool.query("SELECT * FROM rank_keyword_domains WHERE group_id=$1 ORDER BY id ASC", [id])).rows;
  const best = domains.filter((d) => d.last_position).sort((a, b) => a.last_position - b.last_position)[0] || null;
  const suspicious = (await pool.query("SELECT COUNT(*)::int AS count FROM rank_scan_results WHERE group_id=$1 AND classification='suspicious' AND checked_at > NOW() - INTERVAL '7 days'", [id])).rows[0]?.count || 0;
  return { ...group, domains, domain_count: domains.length, suspicious_count: suspicious, domain: domains.map((d) => d.domain).join(", "), last_position: best?.last_position || null, last_page: best?.last_page || null, last_matched_url: best?.last_matched_url || "", last_status: best ? "found" : (domains.length ? "not_found" : "pending"), best_domain: best?.domain || "" };
}

async function upsertKeywordGroup(req, { project, keyword, domains, targetUrl }) {
  const user = currentUser(req);
  const keywordClean = String(keyword || "").trim();
  const keywordLc = keywordClean.toLowerCase();
  if (!keywordClean) throw new Error("Keyword required");
  const group = (await pool.query(`INSERT INTO rank_keyword_groups (user_id, project_name, keyword, keyword_lc) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, keyword_lc) DO UPDATE SET project_name=COALESCE(NULLIF(EXCLUDED.project_name,''), rank_keyword_groups.project_name), keyword=EXCLUDED.keyword RETURNING *`, [user.userId, project || "", keywordClean, keywordLc])).rows[0];
  for (const domain of domains) {
    await pool.query(`INSERT INTO rank_keyword_domains (group_id, domain, target_url, is_whitelisted) VALUES ($1,$2,$3,true) ON CONFLICT (group_id, domain) DO UPDATE SET target_url=COALESCE(NULLIF(EXCLUDED.target_url,''), rank_keyword_domains.target_url), is_whitelisted=true`, [group.id, domain, targetUrl || ""]);
    await pool.query(`INSERT INTO rank_keywords (user_id, project_name, domain, keyword, target_url) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id, domain, keyword) DO UPDATE SET project_name=EXCLUDED.project_name, target_url=EXCLUDED.target_url`, [user.userId, project || "", domain, keywordClean, targetUrl || ""]).catch(() => {});
  }
  return getKeywordGroup(group.id, req);
}

function normalizeSerpItem(item, position, keyword) { return { title: item.title || "", link: item.link || "", snippet: item.snippet || "", position, page: Math.ceil(position / 10), keyword }; }

async function fetchSerperResults(keyword) {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error("SERPER_API_KEY is missing");
  const maxPages = Math.min(10, Math.max(1, Number(process.env.RANK_MAX_PAGES || 10)));
  const all = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const { data } = await axios.post("https://google.serper.dev/search", { q: keyword, gl: process.env.RANK_SERPER_GL || "id", hl: process.env.RANK_SERPER_HL || "id", num: 10, page }, { timeout: 25000, headers: { "X-API-KEY": key, "Content-Type": "application/json" } });
    const organic = Array.isArray(data.organic) ? data.organic : [];
    organic.forEach((item, i) => all.push(normalizeSerpItem(item, (page - 1) * 10 + i + 1, keyword)));
    if (organic.length < 10) break;
  }
  return all.slice(0, 100);
}

async function fetchCustomSearchResults(keyword) {
  const key = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;
  if (!key || !cx) throw new Error("Missing GOOGLE_SEARCH_API_KEY or GOOGLE_SEARCH_CX");
  const maxPages = Math.min(10, Math.max(1, Number(process.env.RANK_MAX_PAGES || 10)));
  const all = [];
  for (let page = 0; page < maxPages; page += 1) {
    const start = page * 10 + 1;
    const { data } = await axios.get("https://www.googleapis.com/customsearch/v1", { timeout: 25000, params: { key, cx, q: keyword, start, num: 10 } });
    const items = Array.isArray(data.items) ? data.items : [];
    items.forEach((item, i) => all.push({ title: item.title || "", link: item.link || "", snippet: item.snippet || "", position: start + i, page: Math.ceil((start + i) / 10), keyword }));
    if (items.length < 10) break;
  }
  return all.slice(0, 100);
}

async function fetchGoogleResults(keyword) { if (process.env.SERPER_API_KEY) return fetchSerperResults(keyword); return fetchCustomSearchResults(keyword); }

async function lookupDomainIntel(domain) {
  const clean = normalizeDomain(domain).replace(/^www\./, "");
  if (!clean) return null;
  const cached = await pool.query("SELECT * FROM domain_intel_cache WHERE domain=$1 AND checked_at > NOW() - INTERVAL '24 hours'", [clean]);
  if (cached.rows[0]) return cached.rows[0];
  let ip = "", nameservers = [], registrar = "", abuseEmail = "", networkName = "", asn = "", reportUrl = "";
  const raw = {};
  try { const records = await dns.resolve4(clean); ip = records[0] || ""; raw.a = records; } catch (err) { raw.a_error = err.code || err.message; }
  try { nameservers = await dns.resolveNs(clean); raw.ns = nameservers; } catch (err) { raw.ns_error = err.code || err.message; }
  try {
    const { data } = await axios.get(`https://rdap.org/domain/${clean}`, { timeout: 12000 });
    raw.domain_rdap = data;
    registrar = data?.registrar?.name || data?.entities?.find((e) => Array.isArray(e.roles) && e.roles.includes("registrar"))?.vcardArray?.[1]?.find((v) => v[0] === "fn")?.[3] || "";
    const emails = [];
    for (const entity of Array.isArray(data.entities) ? data.entities : []) for (const c of entity?.vcardArray?.[1] || []) if (c[0] === "email" && c[3]) emails.push(c[3]);
    abuseEmail = emails.find((e) => /abuse/i.test(e)) || emails[0] || "";
  } catch (err) { raw.domain_rdap_error = err.code || err.message; }
  if (ip) {
    try {
      const { data } = await axios.get(`https://rdap.org/ip/${ip}`, { timeout: 12000 });
      raw.ip_rdap = data;
      networkName = data?.name || data?.handle || "";
      asn = data?.handle || "";
      const emails = [];
      for (const entity of Array.isArray(data.entities) ? data.entities : []) for (const c of entity?.vcardArray?.[1] || []) if (c[0] === "email" && c[3]) emails.push(c[3]);
      if (!abuseEmail) abuseEmail = emails.find((e) => /abuse/i.test(e)) || emails[0] || "";
    } catch (err) { raw.ip_rdap_error = err.code || err.message; }
  }
  const nsJoined = nameservers.join(" ").toLowerCase();
  if (nsJoined.includes("cloudflare")) reportUrl = "https://abuse.cloudflare.com/";
  else if (abuseEmail) reportUrl = `mailto:${abuseEmail}`;
  else reportUrl = `https://www.google.com/search?q=${encodeURIComponent(`${clean} abuse report hosting registrar`)}`;
  return (await pool.query(`INSERT INTO domain_intel_cache (domain, ip, nameservers, registrar, abuse_email, network_name, asn, report_url, raw, checked_at) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9::jsonb,NOW()) ON CONFLICT (domain) DO UPDATE SET ip=EXCLUDED.ip, nameservers=EXCLUDED.nameservers, registrar=EXCLUDED.registrar, abuse_email=EXCLUDED.abuse_email, network_name=EXCLUDED.network_name, asn=EXCLUDED.asn, report_url=EXCLUDED.report_url, raw=EXCLUDED.raw, checked_at=NOW() RETURNING *`, [clean, ip, JSON.stringify(nameservers), registrar, abuseEmail, networkName, asn, reportUrl, JSON.stringify(raw)])).rows[0];
}

async function checkGroup(group) {
  const domains = (await pool.query("SELECT * FROM rank_keyword_domains WHERE group_id=$1 AND is_whitelisted=true ORDER BY id ASC", [group.id])).rows;
  const whitelistDomains = domains.map((d) => d.domain);
  const items = await fetchGoogleResults(group.keyword);
  const now = new Date();
  const suspicious = [];
  await pool.query("DELETE FROM rank_scan_results WHERE group_id=$1 AND checked_at < NOW() - INTERVAL '30 days'", [group.id]);
  for (const item of items) {
    const host = hostFromUrl(item.link || "");
    const classified = classifyResult(item, whitelistDomains, allowedExternalDomains());
    await pool.query(`INSERT INTO rank_scan_results (group_id, keyword, position, page, title, link, snippet, host, classification, reason, checked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [group.id, group.keyword, item.position, item.page, item.title || "", item.link || "", item.snippet || "", host, classified.classification, classified.reason, now]);
    if (classified.classification === "suspicious") suspicious.push({ ...item, host, ...classified });
  }
  for (const d of domains) {
    const match = items.find((item) => domainMatches(item.link || "", d.domain));
    const newPos = match?.position || null;
    const newPage = match?.page || null;
    await pool.query(`UPDATE rank_keyword_domains SET last_position=$1, last_page=$2, last_matched_url=$3, last_status=$4, last_checked_at=NOW() WHERE id=$5`, [newPos, newPage, match?.link || "", match ? "found" : "not_found", d.id]);
    await pool.query(`INSERT INTO rank_results (keyword_id, keyword, domain, position, page, matched_url, source) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [d.id, group.keyword, d.domain, newPos, newPage, match?.link || "", process.env.SERPER_API_KEY ? "serper" : "google_custom_search"]).catch(() => {});
    if (d.last_position && newPos && d.last_position !== newPos) {
      const dir = newPos < d.last_position ? "⬆️" : "⬇️";
      const msg = `${dir} RANK CHANGE\n\nProject: ${group.project_name || "-"}\nKeyword: ${group.keyword}\nDomain: ${d.domain}\nOld: #${d.last_position} (page ${d.last_page || "?"})\nNew: #${newPos} (page ${newPage || "?"})`;
      sendTelegramToProject(group.project_name, msg).catch(() => false);
    }
  }
  for (const s of suspicious.slice(0, 25)) {
    const seen = await pool.query(`INSERT INTO rank_suspicious_seen (group_id, host, last_position, last_page) VALUES ($1,$2,$3,$4) ON CONFLICT (group_id, host) DO UPDATE SET last_seen_at=NOW(), last_position=EXCLUDED.last_position, last_page=EXCLUDED.last_page RETURNING (xmax = 0) AS is_new`, [group.id, s.host, s.position, s.page]);
    s.intel = await lookupDomainIntel(s.host).catch((err) => ({ domain: s.host, error: err.message }));
    if (seen.rows[0]?.is_new && s.position <= Number(process.env.RANK_SUSPICIOUS_ALERT_MAX_POSITION || 30)) await sendTelegram(`SUSPICIOUS GOOGLE RESULT\n\nKeyword: ${group.keyword}\nHost: ${s.host}\nRank: ${s.position}\nPage: ${s.page}\nURL: ${s.link}\nReason: ${s.reason}\nReport: ${s.intel?.report_url || "n/a"}`).catch(() => false);
  }
  await pool.query("UPDATE rank_keyword_groups SET last_checked_at=NOW() WHERE id=$1", [group.id]);
  return { provider: process.env.SERPER_API_KEY ? "serper" : "google_custom_search", total_results: items.length, suspicious_count: suspicious.length, suspicious };
}

router.get("/keywords", async (req, res, next) => { try { await ensureRankTables(); const scope = userParams(req); const groups = (await pool.query(`SELECT * FROM rank_keyword_groups WHERE ${scope.where} ORDER BY id DESC`, scope.params)).rows; const out = []; for (const g of groups) out.push(await getKeywordGroup(g.id, req)); res.json(out.filter(Boolean)); } catch (err) { next(err); } });
router.post("/keywords", async (req, res, next) => { try { await ensureRankTables(); if (currentUser(req)?.role === "demo") return res.status(403).json({ error: "Demo account is read-only" }); const domains = parseDomainList(req.body.domain || req.body.domains || ""); const keyword = String(req.body.keyword || "").trim(); const project = String(req.body.project_name || "").trim(); const targetUrl = String(req.body.target_url || "").trim(); if (!domains.length || !keyword) return res.status(400).json({ error: "Domain and keyword required" }); res.json(await upsertKeywordGroup(req, { project, keyword, domains, targetUrl })); } catch (err) { next(err); } });
router.delete("/keywords/:id", async (req, res, next) => { try { await ensureRankTables(); if (currentUser(req)?.role === "demo") return res.status(403).json({ error: "Demo account is read-only" }); const group = await getKeywordGroup(req.params.id, req); if (!group) return res.status(404).json({ error: "Keyword group not found" }); await pool.query("DELETE FROM rank_keyword_groups WHERE id=$1", [req.params.id]); await pool.query("DELETE FROM rank_keywords WHERE user_id=$1 AND keyword=$2", [group.user_id, group.keyword]).catch(() => {}); res.json({ ok: true }); } catch (err) { next(err); } });
router.get("/results", async (req, res, next) => { try { await ensureRankTables(); const scope = userParams(req); const prefix = scope.params.length ? "g." : ""; const where = scope.params.length ? `${prefix}${scope.where}` : "TRUE"; const { rows } = await pool.query(`SELECT r.id, r.group_id, r.keyword, r.host AS domain, r.position, r.page, r.link AS matched_url, r.title, r.snippet, r.classification, r.reason, r.checked_at FROM rank_scan_results r JOIN rank_keyword_groups g ON g.id=r.group_id WHERE ${where} ORDER BY r.checked_at DESC, r.position ASC LIMIT 1000`, scope.params); res.json(rows); } catch (err) { next(err); } });
router.get("/intel/:domain", async (req, res, next) => { try { await ensureRankTables(); res.json(await lookupDomainIntel(req.params.domain)); } catch (err) { next(err); } });
router.get("/test", async (req, res, next) => { try { const keyword = String(req.query.q || "empire88"); const items = await fetchGoogleResults(keyword); res.json({ ok: true, provider: process.env.SERPER_API_KEY ? "serper" : "google_custom_search", keyword, count: items.length, first: items[0] || null }); } catch (err) { next(err); } });
router.post("/check/:id", async (req, res, next) => { try { await ensureRankTables(); const group = await getKeywordGroup(req.params.id, req); if (!group) return res.status(404).json({ error: "Keyword group not found" }); const result = await checkGroup(group); res.json({ ok: true, ...result, group: await getKeywordGroup(req.params.id, req) }); } catch (err) { next(err); } });
router.post("/check-all", async (req, res, next) => { try { await ensureRankTables(); const scope = userParams(req); const { rows } = await pool.query(`SELECT * FROM rank_keyword_groups WHERE is_active=true AND ${scope.where} ORDER BY id DESC LIMIT 50`, scope.params); const checked = []; for (const group of rows) { try { checked.push({ id: group.id, keyword: group.keyword, ...(await checkGroup(group)) }); } catch (err) { checked.push({ id: group.id, keyword: group.keyword, error: err.message }); } } res.json({ ok: true, checked }); } catch (err) { next(err); } });

router.post("/keywords/:groupId/whitelist-domain", async (req, res, next) => { try { await ensureRankTables(); if (currentUser(req)?.role === "demo") return res.status(403).json({ error: "Demo account is read-only" }); const groupId = Number(req.params.groupId); const domain = normalizeDomain(String(req.body.domain || "").trim()); if (!domain) return res.status(400).json({ error: "Domain required" }); const group = await getKeywordGroup(groupId, req); if (!group) return res.status(404).json({ error: "Group not found" }); await pool.query(`INSERT INTO rank_keyword_domains (group_id, domain, is_whitelisted) VALUES ($1,$2,true) ON CONFLICT (group_id, domain) DO UPDATE SET is_whitelisted=true`, [groupId, domain]); res.json({ ok: true, domain }); } catch (err) { next(err); } });

router.post("/results/:id/classify", async (req, res, next) => { try { await ensureRankTables(); if (currentUser(req)?.role === "demo") return res.status(403).json({ error: "Demo account is read-only" }); const id = Number(req.params.id); const classification = String(req.body.classification || "").trim(); if (!classification) return res.status(400).json({ error: "Classification required" }); const params = isSuperadmin(req) ? [classification, id] : [classification, id, currentUser(req).userId]; const where = isSuperadmin(req) ? "r.id=$2" : "r.id=$2 AND g.user_id=$3"; const { rowCount } = await pool.query(`UPDATE rank_scan_results r SET classification=$1 FROM rank_keyword_groups g WHERE r.group_id=g.id AND ${where}`, params); if (!rowCount) return res.status(404).json({ error: "Result not found" }); res.json({ ok: true, id, classification }); } catch (err) { next(err); } });

module.exports = router;

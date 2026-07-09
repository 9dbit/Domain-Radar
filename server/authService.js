const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { pool } = require("./db");
const { normalizeEmail, isEmailWhitelistEnabled, isEmailAllowed } = require("./authAllowlist");
const { sendVerificationEmail, sendPasswordResetEmail } = require("./emailService");

const ADMIN_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL || "admin@domain-radar.local");
const DEMO_EMAIL = "demo@domain-radar.org";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "demo123456";
const TOKEN_BYTES = 32;

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    userId: user.id,
    tenantId: user.tenant_id,
    email: user.email,
    name: user.name || "",
    role: user.role,
    email_verified: Boolean(user.email_verified),
    onboarding_completed: Boolean(user.onboarding_completed)
  };
}

function storeSession(req, user) {
  const safe = publicUser(user);
  req.session.userId = safe.userId;
  req.session.tenantId = safe.tenantId;
  req.session.role = safe.role;
  req.session.email = safe.email;
  req.session.isAdmin = safe.role === "superadmin";
  req.session.adminEmail = safe.email;
  return safe;
}

function getUser(req) {
  if (!req.session?.userId) return null;
  return {
    userId: req.session.userId,
    tenantId: req.session.tenantId,
    role: req.session.role || "merchant",
    email: req.session.email || req.session.adminEmail || "",
    isSuperadmin: req.session.role === "superadmin"
  };
}

function requireUser(req, res, next) {
  if (getUser(req)) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

function requireAdmin(req, res, next) {
  const user = getUser(req);
  if (user) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

function requireNotDemo(req, res, next) {
  const user = getUser(req);
  if (user?.role === "demo") return res.status(403).json({ error: "Demo account is read-only" });
  return next();
}

function requireSuperAdmin(req, res, next) {
  const user = getUser(req);
  if (user?.role === "superadmin") return next();
  return res.status(403).json({ error: "Superadmin only" });
}

function attachTenant(req, res, next) {
  req.user = getUser(req);
  return next();
}

async function hashPassword(password) {
  return bcrypt.hash(String(password || ""), 12);
}

async function ensureColumn(table, definition) {
  await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${definition}`);
}

async function ensureAuthTables() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      name TEXT DEFAULT '',
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'merchant',
      email_verified BOOLEAN DEFAULT false,
      onboarding_completed BOOLEAN DEFAULT false,
      suspended BOOLEAN DEFAULT false,
      last_active_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await ensureColumn("domains", "user_id UUID REFERENCES users(id)");
  await ensureColumn("proxies", "user_id UUID REFERENCES users(id)");

  await pool.query("ALTER TABLE domains DROP CONSTRAINT IF EXISTS domains_domain_key");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_domains_user_domain ON domains(user_id, domain)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_domains_user_id ON domains(user_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_proxies_user_id ON proxies(user_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_email_tokens_token ON email_tokens(token)");
}

async function findUserByEmail(email) {
  const cleanEmail = normalizeEmail(email || "");
  if (!cleanEmail) return null;
  return (await pool.query("SELECT * FROM users WHERE email=$1", [cleanEmail])).rows[0] || null;
}

async function upsertSystemUser({ email, password, role, name, verified = true }) {
  const existing = await findUserByEmail(email);
  const password_hash = await hashPassword(password);
  if (existing) {
    const { rows } = await pool.query(
      `UPDATE users
       SET role=$2,
           name=COALESCE(NULLIF($3,''), name),
           email_verified=email_verified OR $4,
           password_hash=$5,
           suspended=false,
           updated_at=NOW()
       WHERE email=$1
       RETURNING *`,
      [email, role, name || "", verified, password_hash]
    );
    return rows[0];
  }
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role, name, email_verified)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [email, password_hash, role, name || "", verified]
  );
  return rows[0];
}

async function ensureSystemUsers() {
  await ensureAuthTables();
  const adminPassword = process.env.ADMIN_PASSWORD || "";
  let admin = null;
  if (adminPassword) {
    admin = await upsertSystemUser({ email: ADMIN_EMAIL, password: adminPassword, role: "superadmin", name: "Platform Admin", verified: true });
  }
  const demo = await upsertSystemUser({ email: DEMO_EMAIL, password: DEMO_PASSWORD, role: "demo", name: "Demo Account", verified: true });

  const backfillUser = admin || demo;
  if (backfillUser) {
    await pool.query("UPDATE domains SET user_id=$1 WHERE user_id IS NULL", [backfillUser.id]);
    await pool.query("UPDATE proxies SET user_id=$1 WHERE user_id IS NULL", [backfillUser.id]);
  }
}

function makeToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("hex");
}

async function createEmailToken(userId, type, hours) {
  const token = makeToken();
  await pool.query("DELETE FROM email_tokens WHERE user_id=$1 AND type=$2 AND used_at IS NULL", [userId, type]);
  await pool.query(
    "INSERT INTO email_tokens (user_id, token, type, expires_at) VALUES ($1,$2,$3,NOW() + ($4 || ' hours')::interval)",
    [userId, token, type, String(hours)]
  );
  return token;
}

async function registerUser(req, { name, email, password }) {
  const cleanEmail = normalizeEmail(email || "");
  if (!cleanEmail) throw Object.assign(new Error("Email required"), { status: 400 });
  if (String(password || "").length < 8) throw Object.assign(new Error("Password must be at least 8 characters"), { status: 400 });
  if (isEmailWhitelistEnabled() && !isEmailAllowed(cleanEmail)) throw Object.assign(new Error("Email not whitelisted"), { status: 403 });

  const password_hash = await hashPassword(password);
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, email_verified)
     VALUES ($1,$2,$3,'merchant',false)
     RETURNING *`,
    [String(name || "").trim(), cleanEmail, password_hash]
  ).catch((err) => {
    if (err.code === "23505") throw Object.assign(new Error("Email already registered"), { status: 409 });
    throw err;
  });

  const token = await createEmailToken(rows[0].id, "verify_email", 24);
  const emailSent = await sendVerificationEmail(req, rows[0], token);
  return { user: publicUser(rows[0]), emailSent };
}

async function loginUser(req, { email, password }) {
  const cleanEmail = normalizeEmail(email || "");
  const adminPassword = process.env.ADMIN_PASSWORD || "";

  const user = await findUserByEmail(cleanEmail || ADMIN_EMAIL);
  const legacyAdminLogin = adminPassword && String(password || "") === adminPassword && (!cleanEmail || cleanEmail === ADMIN_EMAIL);
  if (legacyAdminLogin && user?.role === "superadmin") return storeSession(req, user);

  if (!user || user.suspended) throw Object.assign(new Error("Invalid email or password"), { status: 401 });
  const ok = await bcrypt.compare(String(password || ""), user.password_hash || "");
  if (!ok) throw Object.assign(new Error("Invalid email or password"), { status: 401 });

  await pool.query("UPDATE users SET last_active_at=NOW() WHERE id=$1", [user.id]);
  return storeSession(req, user);
}

async function requestPasswordReset(req, email) {
  const user = await findUserByEmail(email);
  if (!user) return { ok: true, emailSent: false };
  const token = await createEmailToken(user.id, "reset_password", 2);
  const emailSent = await sendPasswordResetEmail(req, user, token);
  return { ok: true, emailSent };
}

async function consumeToken(token, type) {
  const { rows } = await pool.query(
    `SELECT t.*, u.email, u.id AS uid
     FROM email_tokens t
     JOIN users u ON u.id=t.user_id
     WHERE t.token=$1 AND t.type=$2 AND t.used_at IS NULL AND t.expires_at > NOW()`,
    [String(token || ""), type]
  );
  if (!rows[0]) throw Object.assign(new Error("Invalid or expired token"), { status: 400 });
  await pool.query("UPDATE email_tokens SET used_at=NOW() WHERE id=$1", [rows[0].id]);
  return rows[0];
}

async function verifyEmail(token) {
  const row = await consumeToken(token, "verify_email");
  await pool.query("UPDATE users SET email_verified=true, updated_at=NOW() WHERE id=$1", [row.user_id]);
  return { ok: true, email: row.email };
}

async function resetPassword(token, password) {
  if (String(password || "").length < 8) throw Object.assign(new Error("Password must be at least 8 characters"), { status: 400 });
  const row = await consumeToken(token, "reset_password");
  const password_hash = await hashPassword(password);
  await pool.query("UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2", [password_hash, row.user_id]);
  return { ok: true };
}

module.exports = {
  ensureAuthTables,
  ensureSystemUsers,
  registerUser,
  loginUser,
  requestPasswordReset,
  verifyEmail,
  resetPassword,
  publicUser,
  storeSession,
  getUser,
  requireUser,
  requireAdmin,
  requireNotDemo,
  requireSuperAdmin,
  attachTenant,
  ADMIN_EMAIL,
  DEMO_EMAIL
};

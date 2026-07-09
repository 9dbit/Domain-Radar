CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
);

CREATE TABLE IF NOT EXISTS domains (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  domain TEXT NOT NULL,
  project_name TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT TRUE,
  global_status TEXT DEFAULT 'unknown',
  last_status TEXT DEFAULT 'unknown',
  last_checked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE domains DROP CONSTRAINT IF EXISTS domains_domain_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_domains_user_domain ON domains(user_id, domain);
CREATE INDEX IF NOT EXISTS idx_domains_user_id ON domains(user_id);

CREATE TABLE IF NOT EXISTS proxies (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  proxy_url TEXT NOT NULL,
  proxy_type TEXT DEFAULT 'http',
  is_active BOOLEAN DEFAULT TRUE,
  last_health_status TEXT DEFAULT 'unknown',
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proxies_user_id ON proxies(user_id);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_user_name ON projects(user_id, name);

CREATE TABLE IF NOT EXISTS provider_nodes (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  network_type TEXT DEFAULT 'broadband',
  endpoint_url TEXT NOT NULL,
  secret_key TEXT DEFAULT '',
  is_platform_node BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT TRUE,
  last_health_status TEXT DEFAULT 'unknown',
  last_health_reason TEXT DEFAULT '',
  last_ping_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE provider_nodes DROP CONSTRAINT IF EXISTS provider_nodes_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_nodes_user_name ON provider_nodes(user_id, name);
CREATE INDEX IF NOT EXISTS idx_provider_nodes_user_id ON provider_nodes(user_id);

CREATE TABLE IF NOT EXISTS merchant_settings (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_merchant_settings_user_id ON merchant_settings(user_id);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_tokens_token ON email_tokens(token);

CREATE TABLE IF NOT EXISTS check_results (
  id SERIAL PRIMARY KEY,
  domain_id INTEGER REFERENCES domains(id) ON DELETE CASCADE,
  checker_type TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  status TEXT NOT NULL,
  http_status INTEGER,
  final_url TEXT,
  dns_result TEXT,
  latency_ms INTEGER,
  reason TEXT,
  checked_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  domain_id INTEGER REFERENCES domains(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT,
  message TEXT,
  sent_to_telegram BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rank_keyword_groups (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  project_name TEXT DEFAULT '',
  keyword TEXT NOT NULL,
  keyword_lc TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  last_checked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE rank_keyword_groups DROP CONSTRAINT IF EXISTS rank_keyword_groups_keyword_lc_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rank_groups_user_keyword ON rank_keyword_groups(user_id, keyword_lc);
CREATE INDEX IF NOT EXISTS idx_rank_groups_user_id ON rank_keyword_groups(user_id);

CREATE TABLE IF NOT EXISTS rank_keyword_domains (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES rank_keyword_groups(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  target_url TEXT DEFAULT '',
  is_whitelisted BOOLEAN DEFAULT TRUE,
  last_position INTEGER,
  last_page INTEGER,
  last_matched_url TEXT,
  last_status TEXT DEFAULT 'pending',
  last_checked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(group_id, domain)
);

CREATE TABLE IF NOT EXISTS rank_keywords (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  project_name TEXT DEFAULT '',
  domain TEXT NOT NULL,
  keyword TEXT NOT NULL,
  target_url TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT TRUE,
  last_position INTEGER,
  last_page INTEGER,
  last_checked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE rank_keywords DROP CONSTRAINT IF EXISTS rank_keywords_domain_keyword_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rank_keywords_user_domain_keyword ON rank_keywords(user_id, domain, keyword);

CREATE TABLE IF NOT EXISTS rank_scan_results (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES rank_keyword_groups(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  position INTEGER,
  page INTEGER,
  title TEXT,
  link TEXT,
  snippet TEXT,
  host TEXT,
  classification TEXT DEFAULT 'unknown',
  reason TEXT DEFAULT '',
  checked_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rank_results (
  id SERIAL PRIMARY KEY,
  keyword_id INTEGER,
  keyword TEXT NOT NULL,
  domain TEXT NOT NULL,
  position INTEGER,
  page INTEGER,
  matched_url TEXT,
  source TEXT DEFAULT 'google_custom_search',
  checked_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS domain_intel_cache (
  domain TEXT PRIMARY KEY,
  ip TEXT,
  nameservers JSONB DEFAULT '[]'::jsonb,
  registrar TEXT DEFAULT '',
  abuse_email TEXT DEFAULT '',
  network_name TEXT DEFAULT '',
  asn TEXT DEFAULT '',
  report_url TEXT DEFAULT '',
  checked_at TIMESTAMP DEFAULT NOW(),
  raw JSONB DEFAULT '{}'::jsonb
);

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
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT gen_random_uuid();
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'merchant';
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

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
ALTER TABLE domains ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE domains ADD COLUMN IF NOT EXISTS project_name TEXT DEFAULT '';
ALTER TABLE domains ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS global_status TEXT DEFAULT 'unknown';
ALTER TABLE domains ADD COLUMN IF NOT EXISTS last_status TEXT DEFAULT 'unknown';
ALTER TABLE domains ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMP;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
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
ALTER TABLE proxies ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE proxies ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE proxies ADD COLUMN IF NOT EXISTS provider_name TEXT;
ALTER TABLE proxies ADD COLUMN IF NOT EXISTS proxy_url TEXT;
ALTER TABLE proxies ADD COLUMN IF NOT EXISTS proxy_type TEXT DEFAULT 'http';
ALTER TABLE proxies ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE proxies ADD COLUMN IF NOT EXISTS last_health_status TEXT DEFAULT 'unknown';
ALTER TABLE proxies ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_proxies_user_id ON proxies(user_id);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
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
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS provider_name TEXT;
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS network_type TEXT DEFAULT 'broadband';
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS endpoint_url TEXT;
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS secret_key TEXT DEFAULT '';
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS is_platform_node BOOLEAN DEFAULT false;
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS last_health_status TEXT DEFAULT 'unknown';
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS last_health_reason TEXT DEFAULT '';
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS last_ping_at TIMESTAMP;
ALTER TABLE provider_nodes ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
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
ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS key TEXT;
ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS value TEXT;
ALTER TABLE merchant_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_merchant_settings_user_id ON merchant_settings(user_id);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS value TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

CREATE TABLE IF NOT EXISTS email_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE email_tokens ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE email_tokens ADD COLUMN IF NOT EXISTS token TEXT;
ALTER TABLE email_tokens ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE email_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
ALTER TABLE email_tokens ADD COLUMN IF NOT EXISTS used_at TIMESTAMP;
ALTER TABLE email_tokens ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
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
ALTER TABLE check_results ADD COLUMN IF NOT EXISTS domain_id INTEGER REFERENCES domains(id) ON DELETE CASCADE;
ALTER TABLE check_results ADD COLUMN IF NOT EXISTS checker_type TEXT;
ALTER TABLE check_results ADD COLUMN IF NOT EXISTS provider_name TEXT;
ALTER TABLE check_results ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE check_results ADD COLUMN IF NOT EXISTS http_status INTEGER;
ALTER TABLE check_results ADD COLUMN IF NOT EXISTS final_url TEXT;
ALTER TABLE check_results ADD COLUMN IF NOT EXISTS dns_result TEXT;
ALTER TABLE check_results ADD COLUMN IF NOT EXISTS latency_ms INTEGER;
ALTER TABLE check_results ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE check_results ADD COLUMN IF NOT EXISTS checked_at TIMESTAMP DEFAULT NOW();

CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  domain_id INTEGER REFERENCES domains(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT,
  message TEXT,
  sent_to_telegram BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS domain_id INTEGER REFERENCES domains(id) ON DELETE CASCADE;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS old_status TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS new_status TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS sent_to_telegram BOOLEAN DEFAULT FALSE;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

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
ALTER TABLE rank_keyword_groups ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE rank_keyword_groups ADD COLUMN IF NOT EXISTS project_name TEXT DEFAULT '';
ALTER TABLE rank_keyword_groups ADD COLUMN IF NOT EXISTS keyword TEXT;
ALTER TABLE rank_keyword_groups ADD COLUMN IF NOT EXISTS keyword_lc TEXT;
ALTER TABLE rank_keyword_groups ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE rank_keyword_groups ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMP;
ALTER TABLE rank_keyword_groups ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
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
ALTER TABLE rank_keyword_domains ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES rank_keyword_groups(id) ON DELETE CASCADE;
ALTER TABLE rank_keyword_domains ADD COLUMN IF NOT EXISTS domain TEXT;
ALTER TABLE rank_keyword_domains ADD COLUMN IF NOT EXISTS target_url TEXT DEFAULT '';
ALTER TABLE rank_keyword_domains ADD COLUMN IF NOT EXISTS is_whitelisted BOOLEAN DEFAULT TRUE;
ALTER TABLE rank_keyword_domains ADD COLUMN IF NOT EXISTS last_position INTEGER;
ALTER TABLE rank_keyword_domains ADD COLUMN IF NOT EXISTS last_page INTEGER;
ALTER TABLE rank_keyword_domains ADD COLUMN IF NOT EXISTS last_matched_url TEXT;
ALTER TABLE rank_keyword_domains ADD COLUMN IF NOT EXISTS last_status TEXT DEFAULT 'pending';
ALTER TABLE rank_keyword_domains ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMP;
ALTER TABLE rank_keyword_domains ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

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
ALTER TABLE rank_keywords ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
ALTER TABLE rank_keywords ADD COLUMN IF NOT EXISTS project_name TEXT DEFAULT '';
ALTER TABLE rank_keywords ADD COLUMN IF NOT EXISTS domain TEXT;
ALTER TABLE rank_keywords ADD COLUMN IF NOT EXISTS keyword TEXT;
ALTER TABLE rank_keywords ADD COLUMN IF NOT EXISTS target_url TEXT DEFAULT '';
ALTER TABLE rank_keywords ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE rank_keywords ADD COLUMN IF NOT EXISTS last_position INTEGER;
ALTER TABLE rank_keywords ADD COLUMN IF NOT EXISTS last_page INTEGER;
ALTER TABLE rank_keywords ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMP;
ALTER TABLE rank_keywords ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
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
ALTER TABLE rank_scan_results ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES rank_keyword_groups(id) ON DELETE CASCADE;
ALTER TABLE rank_scan_results ADD COLUMN IF NOT EXISTS keyword TEXT;
ALTER TABLE rank_scan_results ADD COLUMN IF NOT EXISTS position INTEGER;
ALTER TABLE rank_scan_results ADD COLUMN IF NOT EXISTS page INTEGER;
ALTER TABLE rank_scan_results ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE rank_scan_results ADD COLUMN IF NOT EXISTS link TEXT;
ALTER TABLE rank_scan_results ADD COLUMN IF NOT EXISTS snippet TEXT;
ALTER TABLE rank_scan_results ADD COLUMN IF NOT EXISTS host TEXT;
ALTER TABLE rank_scan_results ADD COLUMN IF NOT EXISTS classification TEXT DEFAULT 'unknown';
ALTER TABLE rank_scan_results ADD COLUMN IF NOT EXISTS reason TEXT DEFAULT '';
ALTER TABLE rank_scan_results ADD COLUMN IF NOT EXISTS checked_at TIMESTAMP DEFAULT NOW();

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
ALTER TABLE rank_results ADD COLUMN IF NOT EXISTS keyword_id INTEGER;
ALTER TABLE rank_results ADD COLUMN IF NOT EXISTS keyword TEXT;
ALTER TABLE rank_results ADD COLUMN IF NOT EXISTS domain TEXT;
ALTER TABLE rank_results ADD COLUMN IF NOT EXISTS position INTEGER;
ALTER TABLE rank_results ADD COLUMN IF NOT EXISTS page INTEGER;
ALTER TABLE rank_results ADD COLUMN IF NOT EXISTS matched_url TEXT;
ALTER TABLE rank_results ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'google_custom_search';
ALTER TABLE rank_results ADD COLUMN IF NOT EXISTS checked_at TIMESTAMP DEFAULT NOW();

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
ALTER TABLE domain_intel_cache ADD COLUMN IF NOT EXISTS ip TEXT;
ALTER TABLE domain_intel_cache ADD COLUMN IF NOT EXISTS nameservers JSONB DEFAULT '[]'::jsonb;
ALTER TABLE domain_intel_cache ADD COLUMN IF NOT EXISTS registrar TEXT DEFAULT '';
ALTER TABLE domain_intel_cache ADD COLUMN IF NOT EXISTS abuse_email TEXT DEFAULT '';
ALTER TABLE domain_intel_cache ADD COLUMN IF NOT EXISTS network_name TEXT DEFAULT '';
ALTER TABLE domain_intel_cache ADD COLUMN IF NOT EXISTS asn TEXT DEFAULT '';
ALTER TABLE domain_intel_cache ADD COLUMN IF NOT EXISTS report_url TEXT DEFAULT '';
ALTER TABLE domain_intel_cache ADD COLUMN IF NOT EXISTS checked_at TIMESTAMP DEFAULT NOW();
ALTER TABLE domain_intel_cache ADD COLUMN IF NOT EXISTS raw JSONB DEFAULT '{}'::jsonb;

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

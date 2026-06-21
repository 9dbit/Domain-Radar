CREATE TABLE IF NOT EXISTS domains (
  id SERIAL PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  project_name TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT TRUE,
  global_status TEXT DEFAULT 'unknown',
  last_status TEXT DEFAULT 'unknown',
  last_checked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proxies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  proxy_url TEXT NOT NULL,
  proxy_type TEXT DEFAULT 'http',
  is_active BOOLEAN DEFAULT TRUE,
  last_health_status TEXT DEFAULT 'unknown',
  created_at TIMESTAMP DEFAULT NOW()
);

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

require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("neon.tech") ? { rejectUnauthorized: false } : undefined
});

function defaultSecret(name) {
  return `${String(name || "node").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-secret-001`;
}

const nodes = [
  { name: "TELKOMSEL-JKT-01", provider_name: "Telkomsel", network_type: "mobile" },
  { name: "XL-JKT-01", provider_name: "XL", network_type: "mobile" },
  { name: "INDOSAT-JKT-01", provider_name: "Indosat", network_type: "mobile" },
  { name: "TRI-JKT-01", provider_name: "Tri", network_type: "mobile" },
  { name: "SMARTFREN-JKT-01", provider_name: "Smartfren", network_type: "mobile" },
  { name: "BIZNET-JKT-01", provider_name: "Biznet", network_type: "broadband" },
  { name: "INDIHOME-JKT-01", provider_name: "IndiHome", network_type: "broadband" }
].map((n) => ({ ...n, endpoint_url: `poll://${n.name}`, secret_key: defaultSecret(n.name) }));

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS provider_nodes (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      provider_name TEXT NOT NULL,
      network_type TEXT DEFAULT 'broadband',
      endpoint_url TEXT NOT NULL,
      secret_key TEXT DEFAULT '',
      is_active BOOLEAN DEFAULT TRUE,
      last_health_status TEXT DEFAULT 'unknown',
      last_ping_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  for (const node of nodes) {
    await pool.query(
      `INSERT INTO provider_nodes (name, provider_name, network_type, endpoint_url, secret_key, is_active)
       VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (name) DO UPDATE SET
         provider_name=EXCLUDED.provider_name,
         network_type=EXCLUDED.network_type,
         endpoint_url=EXCLUDED.endpoint_url,
         secret_key=EXCLUDED.secret_key,
         is_active=true
       RETURNING *`,
      [node.name, node.provider_name, node.network_type, node.endpoint_url, node.secret_key]
    );
    console.log(`${node.name} | ${node.endpoint_url} | ${node.secret_key}`);
  }

  console.log(`Seeded ${nodes.length} polling provider nodes.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());

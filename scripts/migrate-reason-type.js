require("dotenv").config();
const { pool } = require("../server/db");
const { classifyReasonType } = require("../server/reasonClassifier");

async function main() {
  await pool.query("ALTER TABLE check_results ADD COLUMN IF NOT EXISTS reason_type TEXT DEFAULT 'UNKNOWN'");
  const { rows } = await pool.query("SELECT id, status, http_status, final_url, reason FROM check_results WHERE reason_type IS NULL OR reason_type='UNKNOWN' ORDER BY id DESC LIMIT 5000");
  for (const row of rows) {
    await pool.query("UPDATE check_results SET reason_type=$1 WHERE id=$2", [classifyReasonType(row), row.id]);
  }
  console.log(`Reason type migration done. Updated up to ${rows.length} rows.`);
}

main().then(() => pool.end()).catch((err) => {
  console.error(err);
  process.exit(1);
});

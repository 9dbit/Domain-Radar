const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { pool } = require("./index");

async function initDatabase() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");

  await pool.query(schema);
  await pool.end();

  console.log("Database schema initialized successfully.");
}

initDatabase().catch((err) => {
  console.error("Database init failed:", err.message);
  process.exit(1);
});

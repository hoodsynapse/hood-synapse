const { Pool } = require('pg');

let pool;
function db() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000
    });
  }
  return pool;
}

async function q(text, params) {
  const r = await db().query(text, params);
  return r.rows;
}

module.exports = { db, q };

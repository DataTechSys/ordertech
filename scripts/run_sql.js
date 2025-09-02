#!/usr/bin/env node
/* Run an arbitrary SQL file against DATABASE_URL using node-postgres.
 * - Wraps in a transaction by default.
 * - Prints per-statement rowCount and any SELECT rows as JSON.
 * Usage: node scripts/run_sql.js <path.sql>
 */
const fs = require('fs');
const { Pool } = require('pg');

function splitSql(txt){
  // naive split on semicolons at line boundaries
  return String(txt||'')
    .split(/;\s*(?:\r?\n|$)/)
    .map(s => s.trim())
    .filter(Boolean);
}

async function main(){
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error('DATABASE_URL not set. Aborting.');
    process.exit(1);
  }
  const file = process.argv[2];
  const sqlText = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  const statements = splitSql(sqlText);
  if (!statements.length) { console.error('No SQL statements found.'); process.exit(1); }

  const pool = new Pool({ connectionString: DATABASE_URL });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    let idx = 0;
    for (const stmt of statements) {
      idx++;
      const res = await c.query(stmt);
      const cmd = (res.command||'').toUpperCase();
      if (cmd === 'SELECT') {
        console.log(`-- [${idx}] SELECT rows=${res.rowCount}`);
        // For small result sets print rows; otherwise, just the count
        if (res.rowCount <= 50) {
          console.log(JSON.stringify(res.rows, null, 2));
        }
      } else {
        console.log(`-- [${idx}] ${cmd||'QUERY'} rowCount=${res.rowCount}`);
      }
    }
    await c.query('COMMIT');
    console.log('-- Transaction committed.');
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    console.error('SQL execution failed:', e.message || e);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
}

main();


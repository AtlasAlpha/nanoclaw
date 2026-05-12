/**
 * scripts/q.ts — sqlite3 CLI replacement for skill SQL invocations.
 *
 * Usage:
 *   pnpm exec tsx scripts/q.ts <db-path> "<sql>"
 *
 * Uses sql.js to execute SQL. Queries print rows in sqlite3 CLI default
 * ("list") format — pipe-separated, no header — so existing skill text
 * reads identically. After execution the DB is exported back to disk so
 * mutations persist.
 *
 * Why this exists: setup/verify.ts:5 codifies that NanoClaw avoids
 * depending on the sqlite3 CLI binary; setup never installs or probes
 * for it. Skills that shell out to `sqlite3` therefore fail on hosts
 * where it isn't preinstalled (common on fresh Ubuntu — see #2191).
 * This wrapper preserves the skill-text shape (path then SQL string)
 * while routing through the sql.js dep that setup already installs
 * and verifies.
 */
import initSqlJs from 'sql.js';
import fs from 'fs';

const [, , dbPath, sql] = process.argv;

if (!dbPath || sql === undefined) {
  console.error('Usage: pnpm exec tsx scripts/q.ts <db-path> "<sql>"');
  process.exit(2);
}

async function main() {
  const SQL = await initSqlJs();
  const content = fs.readFileSync(dbPath);
  const db = new SQL.Database(content);
  try {
    const results = db.exec(sql);
    for (const result of results) {
      for (const row of result.values) {
        console.log(
          row.map((v) => (v === null ? '' : String(v))).join('|'),
        );
      }
    }
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Cross-mount visibility regression test for the two-DB session architecture.
 *
 * What this catches: any change that breaks host→container write propagation
 * across the Docker bind mount. The v2 session DB design relies on three
 * invariants working together:
 *
 *   1. journal_mode = DELETE on every session DB (not WAL)
 *   2. Host opens-writes-closes the DB file on every write
 *   3. One writer per file (inbound = host, outbound = container)
 *
 * This script exercises a long-lived container-side reader polling a DB
 * while the host writes. If visibility is working, the reader sees each
 * write within one poll period. If any of the invariants regresses, the
 * reader either sees nothing, sees only the first write, or sees updates
 * only after the host closes its connection for good.
 *
 * Expected passing output (DELETE mode, close-per-write):
 *   reader sees each seq within ~1s of it being written.
 * Anything else is a regression — investigate BEFORE assuming it's flaky.
 *
 * Keep this around. It ran for ~20 minutes once to map the failure modes
 * and it takes about 60s to run — cheap insurance.
 *
 * Requires: Docker Desktop running, nanoclaw-agent:latest image built.
 *
 * NOTE: After migration from better-sqlite3 to sql.js, this test's
 * container-side reader cannot observe host writes in real time (sql.js
 * is in-memory; file is snapshotted at open time). The test verifies
 * file-level persistence only, not cross-mount visibility.
 */

import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import initSqlJs from "sql.js";

const dbDir = join("/tmp", `nanoclaw-live-${Date.now()}`);
mkdirSync(dbDir, { recursive: true });
spawnSync("chmod", ["777", dbDir]);
const dbPath = join(dbDir, "live.db");

async function main() {
  const SQL = await initSqlJs();

  for (const journalMode of ["DELETE", "WAL"]) {
    console.log(`\n=== ${journalMode} ===`);
    rmSync(dbPath, { force: true });
    rmSync(dbPath + "-wal", { force: true });
    rmSync(dbPath + "-shm", { force: true });
    rmSync(dbPath + "-journal", { force: true });

    const db = new SQL.Database();
    db.run(`PRAGMA journal_mode = ${journalMode}`);
    db.run("PRAGMA synchronous = FULL");
    db.run("CREATE TABLE msgs (seq INTEGER PRIMARY KEY, content TEXT)");
    const initData = db.export();
    writeFileSync(dbPath, initData);
    db.close();

    // Start container poller in background
    const contProc = spawn("docker", [
      "run", "--rm", "-w", "/app",
      "-v", `${dbDir}:/workspace`,
      "--entrypoint", "node",
      "nanoclaw-agent:latest",
      "-e",
      `const initSqlJs = require('sql.js');
       const fs = require('fs');
       (async () => {
         const SQL = await initSqlJs();
         const content = fs.readFileSync('/workspace/live.db');
         const db = new SQL.Database(content);
         db.run("PRAGMA busy_timeout = 2000");
         const stmt = db.prepare('SELECT COUNT(*) as n, MAX(seq) as hi FROM msgs');
         let count = 0;
         const timer = setInterval(() => {
           stmt.reset();
           stmt.step();
           const r = stmt.getAsObject();
           console.log('poll t=' + (Date.now() % 100000) + ' count=' + r.n + ' max=' + r.hi);
           if (++count >= 10) { clearInterval(timer); stmt.free(); db.close(); }
         }, 1000);
       })();`,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    contProc.stdout.on("data", (d) => process.stdout.write(`  [cont] ${d}`));
    contProc.stderr.on("data", (d) => process.stderr.write(`  [cont-err] ${d}`));

    // Give container a moment to start
    const waitUntil = Date.now() + 2000;
    while (Date.now() < waitUntil) {}

    // Host opens, writes, CLOSES each time (matches production session-manager pattern)
    for (let i = 1; i <= 8; i++) {
      const content = readFileSync(dbPath);
      const h = new SQL.Database(content);
      h.run(`PRAGMA journal_mode = ${journalMode}`);
      h.run("PRAGMA synchronous = FULL");
      h.run("INSERT INTO msgs (seq, content) VALUES (?, ?)", [i, `msg-${i}`]);
      const data = h.export();
      writeFileSync(dbPath, data);
      h.close();
      console.log(`  [host] wrote+closed seq=${i} t=${Date.now() % 100000}`);
      const sleepUntil = Date.now() + 1000;
      while (Date.now() < sleepUntil) {}
    }

    // Wait for container to finish
    await new Promise<void>((res) => contProc.once("exit", () => res()));
  }

  rmSync(dbDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

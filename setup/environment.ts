/**
 * Step: environment — Detect OS, Node, container runtimes, existing config.
 * Replaces 01-check-environment.sh
 */
import fs from 'fs';
import path from 'path';

import initSqlJs, { Database } from 'sql.js';

import { log } from '../src/log.js';
import { commandExists, getPlatform, isHeadless, isWSL } from './platform.js';
import { emitStatus } from './status.js';

/**
 * Read a single key from `.env` on disk (not process.env).
 * Returns the trimmed value or null if the key isn't set / file doesn't exist.
 */
export function readEnvKey(key: string, projectRoot?: string): string | null {
  const envPath = path.join(projectRoot ?? process.cwd(), '.env');
  let content: string;
  try {
    content = fs.readFileSync(envPath, 'utf-8');
  } catch {
    return null;
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    if (trimmed.slice(0, eq) === key) {
      return trimmed.slice(eq + 1).trim() || null;
    }
  }
  return null;
}

export async function detectExistingDisplayName(projectRoot: string): Promise<string | null> {
  const dbPath = path.join(projectRoot, 'data', 'v2.db');
  if (!fs.existsSync(dbPath)) return null;

  const SQL = await initSqlJs();
  let db: Database | null = null;
  try {
    const content = fs.readFileSync(dbPath);
    db = new SQL.Database(content);
    const stmt = db.prepare(`SELECT display_name FROM users WHERE id = 'cli:local'`);
    stmt.step();
    const row = stmt.getAsObject() as { display_name: string } | undefined;
    stmt.free();
    return row?.display_name?.trim() || null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function detectRegisteredGroups(projectRoot: string): Promise<boolean> {
  if (fs.existsSync(path.join(projectRoot, 'data', 'registered_groups.json'))) {
    return true;
  }

  const dbPath = path.join(projectRoot, 'data', 'v2.db');
  if (!fs.existsSync(dbPath)) return false;

  const SQL = await initSqlJs();
  let db: Database | null = null;
  try {
    const content = fs.readFileSync(dbPath);
    db = new SQL.Database(content);
    const stmt = db.prepare(
      `SELECT COUNT(DISTINCT ag.id) as count FROM agent_groups ag
       JOIN messaging_group_agents mga ON mga.agent_group_id = ag.id`,
    );
    stmt.step();
    const row = stmt.getAsObject() as { count: number };
    stmt.free();
    return row.count > 0;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

export async function run(_args: string[]): Promise<void> {
  const projectRoot = process.cwd();

  log.info('Starting environment check');

  const platform = getPlatform();
  const wsl = isWSL();
  const headless = isHeadless();

  // Check Docker
  let docker: 'running' | 'installed_not_running' | 'not_found' = 'not_found';
  if (commandExists('docker')) {
    try {
      const { execSync } = await import('child_process');
      execSync('docker info', { stdio: 'ignore' });
      docker = 'running';
    } catch {
      docker = 'installed_not_running';
    }
  }

  // Check existing config
  const hasEnv = fs.existsSync(path.join(projectRoot, '.env'));

  const authDir = path.join(projectRoot, 'store', 'auth');
  const hasAuth = fs.existsSync(authDir) && fs.readdirSync(authDir).length > 0;

  const hasRegisteredGroups = await detectRegisteredGroups(projectRoot);

  // Check for existing OpenClaw installation
  const homedir = (await import('os')).homedir();
  const openClawPath =
    fs.existsSync(path.join(homedir, '.openclaw')) ? path.join(homedir, '.openclaw') :
    fs.existsSync(path.join(homedir, '.clawdbot')) ? path.join(homedir, '.clawdbot') :
    null;

  log.info(
    'Environment check complete',
    {
      platform,
      wsl,
      docker,
      hasEnv,
      hasAuth,
      hasRegisteredGroups,
      openClawPath,
    },
  );

  emitStatus('CHECK_ENVIRONMENT', {
    PLATFORM: platform,
    IS_WSL: wsl,
    IS_HEADLESS: headless,
    DOCKER: docker,
    HAS_ENV: hasEnv,
    HAS_AUTH: hasAuth,
    HAS_REGISTERED_GROUPS: hasRegisteredGroups,
    OPENCLAW_PATH: openClawPath ?? 'none',
    STATUS: 'success',
    LOG: 'logs/setup.log',
  });
}

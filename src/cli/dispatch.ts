import { getAgentGroup } from '../db/agent-groups.js';
import { getSession } from '../db/sessions.js';
import type { CallerContext, ErrorCode, RequestFrame, ResponseFrame } from './frame.js';
import { lookup } from './registry.js';

export async function dispatch(req: RequestFrame, ctx: CallerContext): Promise<ResponseFrame> {
  const cmd = lookup(req.command);
  if (!cmd) {
    return err(req.id, 'unknown-command', `no command "${req.command}"`);
  }

  let parsed: unknown;
  try {
    parsed = cmd.parseArgs(req.args);
  } catch (e) {
    return err(req.id, 'invalid-args', errMsg(e));
  }

  try {
    const data = await cmd.handler(parsed, ctx);
    return { id: req.id, ok: true, data };
  } catch (e) {
    return err(req.id, 'handler-error', errMsg(e));
  }
}

function err(id: string, code: ErrorCode, message: string): ResponseFrame {
  return { id, ok: false, error: { code, message } };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

import type { CallerContext } from './frame.js';

export type Access = 'open' | 'approval' | 'hidden';

export type CommandDef<TArgs = unknown, TData = unknown> = {
  name: string;
  description: string;
  access: Access;
  resource?: string;
  parseArgs: (raw: Record<string, unknown>) => TArgs;
  handler: (args: TArgs, ctx: CallerContext) => Promise<TData>;
};

const registry = new Map<string, CommandDef>();

export function register<TArgs, TData>(def: CommandDef<TArgs, TData>): void {
  if (registry.has(def.name)) {
    throw new Error(`CLI command "${def.name}" already registered`);
  }
  registry.set(def.name, def as CommandDef);
}

export function lookup(name: string): CommandDef | undefined {
  return registry.get(name);
}

export function listCommands(): CommandDef[] {
  return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name));
}

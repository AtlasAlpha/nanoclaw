import { randomUUID } from 'crypto';

import { getDb } from '../db/connection.js';
import { queryAll, queryOne, run } from '../db/sql-helpers.js';
import { register } from './registry.js';
import type { CallerContext } from './frame.js';

export type Access = 'open' | 'approval' | 'hidden';

export interface ColumnDef {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  description: string;
  generated?: boolean;
  required?: boolean;
  updatable?: boolean;
  default?: unknown;
  enum?: string[];
}

export interface CustomOperation {
  access: Access;
  description: string;
  args?: ColumnDef[];
  handler: (args: Record<string, unknown>, ctx: CallerContext) => Promise<unknown>;
}

export interface ResourceDef {
  name: string;
  plural: string;
  table: string;
  description: string;
  idColumn: string;
  columns: ColumnDef[];
  operations: {
    list?: Access;
    get?: Access;
    create?: Access;
    update?: Access;
    delete?: Access;
  };
  customOperations?: Record<string, CustomOperation>;
}

const resources = new Map<string, ResourceDef>();

export function getResources(): ResourceDef[] {
  return [...resources.values()].sort((a, b) => a.plural.localeCompare(b.plural));
}

export function getResource(plural: string): ResourceDef | undefined {
  return resources.get(plural);
}

function visibleColumns(def: ResourceDef): string[] {
  return def.columns.map((c) => c.name);
}

function genericList(def: ResourceDef) {
  const cols = visibleColumns(def).join(', ');
  const filterableNames = new Set(def.columns.filter((c) => !c.generated).map((c) => c.name));
  return async (args: Record<string, unknown>) => {
    const limit = args.limit !== undefined ? Math.max(1, Number(args.limit)) : 200;
    const filters: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(args)) {
      if (k === 'id' || k === 'limit') continue;
      if (filterableNames.has(k)) {
        filters.push(`${k} = ?`);
        params.push(v);
      }
    }
    const where = filters.length > 0 ? ` WHERE ${filters.join(' AND ')}` : '';
    params.push(limit);
    return queryAll(getDb(), `SELECT ${cols} FROM ${def.table}${where} LIMIT ?`, params);
  };
}

function genericGet(def: ResourceDef) {
  const cols = visibleColumns(def).join(', ');
  return async (args: Record<string, unknown>) => {
    const id = args.id as string;
    if (!id) throw new Error(`${def.name} id is required`);
    const row = queryOne<Record<string, unknown>>(getDb(), `SELECT ${cols} FROM ${def.table} WHERE ${def.idColumn} = ?`, [id]);
    if (!row) throw new Error(`${def.name} not found: ${id}`);
    return row;
  };
}

function genericCreate(def: ResourceDef) {
  return async (args: Record<string, unknown>) => {
    const values: Record<string, unknown> = {};

    for (const col of def.columns) {
      if (col.generated) {
        if (col.name === def.idColumn) {
          values[col.name] = randomUUID();
        } else if (col.name.endsWith('_at')) {
          values[col.name] = new Date().toISOString();
        }
        continue;
      }

      const v = args[col.name];
      if (v !== undefined) {
        if (col.enum && !col.enum.includes(String(v))) {
          throw new Error(`${col.name} must be one of: ${col.enum.join(', ')}`);
        }
        values[col.name] = col.type === 'number' ? Number(v) : v;
      } else if (col.required) {
        throw new Error(`--${col.name.replace(/_/g, '-')} is required`);
      } else if (col.default !== undefined) {
        values[col.name] = col.default;
      }
    }

    const colNames = Object.keys(values);
    const placeholders = colNames.map(() => '?');
    const params = colNames.map((c) => values[c]);
    getDb().run(`INSERT INTO ${def.table} (${colNames.join(', ')}) VALUES (${placeholders.join(', ')})`, params as never);
    return values;
  };
}

function genericUpdate(def: ResourceDef) {
  const updatableCols = def.columns.filter((c) => c.updatable);
  return async (args: Record<string, unknown>) => {
    const id = args.id as string;
    if (!id) throw new Error(`${def.name} id is required`);

    const updates: Record<string, unknown> = {};
    for (const col of updatableCols) {
      const v = args[col.name];
      if (v !== undefined) {
        if (col.enum && !col.enum.includes(String(v))) {
          throw new Error(`${col.name} must be one of: ${col.enum.join(', ')}`);
        }
        updates[col.name] = col.type === 'number' ? Number(v) : v;
      }
    }
    if (Object.keys(updates).length === 0) {
      throw new Error(`nothing to update — provide at least one of: ${updatableCols.map((c) => '--' + c.name.replace(/_/g, '-')).join(', ')}`);
    }

    const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    const params = [...Object.values(updates), id];
    const result = run(getDb(), `UPDATE ${def.table} SET ${setClause} WHERE ${def.idColumn} = ?`, params);
    if (result.changes === 0) throw new Error(`${def.name} not found: ${id}`);

    const cols = visibleColumns(def).join(', ');
    return queryOne<Record<string, unknown>>(getDb(), `SELECT ${cols} FROM ${def.table} WHERE ${def.idColumn} = ?`, [id]);
  };
}

function genericDelete(def: ResourceDef) {
  return async (args: Record<string, unknown>) => {
    const id = args.id as string;
    if (!id) throw new Error(`${def.name} id is required`);
    const result = run(getDb(), `DELETE FROM ${def.table} WHERE ${def.idColumn} = ?`, [id]);
    if (result.changes === 0) throw new Error(`${def.name} not found: ${id}`);
    return { deleted: id };
  };
}

function normalizeArgs(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k.replace(/-/g, '_')] = v;
  }
  return out;
}

export function registerResource(def: ResourceDef): void {
  resources.set(def.plural, def);

  if (def.operations.list) {
    register({
      name: `${def.plural}-list`,
      description: `List all ${def.plural}.`,
      access: def.operations.list,
      resource: def.plural,
      parseArgs: (raw) => normalizeArgs(raw),
      handler: genericList(def),
    });
  }

  if (def.operations.get) {
    register({
      name: `${def.plural}-get`,
      description: `Get a ${def.name} by ID.`,
      access: def.operations.get,
      resource: def.plural,
      parseArgs: (raw) => normalizeArgs(raw),
      handler: genericGet(def),
    });
  }

  if (def.operations.create) {
    register({
      name: `${def.plural}-create`,
      description: `Create a new ${def.name}.`,
      access: def.operations.create,
      resource: def.plural,
      parseArgs: (raw) => normalizeArgs(raw),
      handler: genericCreate(def),
    });
  }

  if (def.operations.update) {
    register({
      name: `${def.plural}-update`,
      description: `Update a ${def.name}.`,
      access: def.operations.update,
      resource: def.plural,
      parseArgs: (raw) => normalizeArgs(raw),
      handler: genericUpdate(def),
    });
  }

  if (def.operations.delete) {
    register({
      name: `${def.plural}-delete`,
      description: `Delete a ${def.name}.`,
      access: def.operations.delete,
      resource: def.plural,
      parseArgs: (raw) => normalizeArgs(raw),
      handler: genericDelete(def),
    });
  }

  if (def.customOperations) {
    for (const [verb, op] of Object.entries(def.customOperations)) {
      register({
        name: `${def.plural}-${verb}`,
        description: op.description,
        access: op.access,
        resource: def.plural,
        parseArgs: (raw) => normalizeArgs(raw),
        handler: async (args, ctx) => op.handler(args as Record<string, unknown>, ctx),
      });
    }
  }
}

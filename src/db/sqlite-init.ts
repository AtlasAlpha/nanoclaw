import initSqlJs, { SqlJsStatic } from 'sql.js';

let SQL: SqlJsStatic | null = null;

export async function initSql(): Promise<SqlJsStatic> {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

export function getSqlJs(): SqlJsStatic {
  if (!SQL) throw new Error('sql.js not initialized. Call initSql() first.');
  return SQL;
}

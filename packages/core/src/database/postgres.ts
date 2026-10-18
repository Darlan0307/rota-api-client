import pg from 'pg';
import Cursor from 'pg-cursor';
import {
  type ConnectOptions,
  DatabaseError,
  type DbSession,
  describeNetworkError,
  toDbValue,
  toSafeNumber,
  withTimeout,
} from './common';
import { quoteIdentifier, readOnlyViolation } from './sql';
import type { DbConnectionConfig, DbQueryResult, DbSchema, DbServerInfo, DbTable, DbValue } from './types';
import { DEFAULT_ROW_LIMIT } from './types';

// OIDs: datas e horas ficam como o banco escreveu (sem converter fuso); números
// grandes viram número só quando não perdem precisão.
const AS_TEXT = new Set([1082, 1083, 1114, 1184, 1266, 1186]);
const NUMERIC = new Set([20, 1700]);

const types = {
  getTypeParser(oid: number, format?: string) {
    if (AS_TEXT.has(oid)) return (value: string) => value;
    if (NUMERIC.has(oid)) return (value: string) => toSafeNumber(value);
    return pg.types.getTypeParser(oid, format as 'text');
  },
} as unknown as pg.CustomTypesConfig;

/** Mensagens em português para os erros mais comuns do PostgreSQL. */
export function describePostgresError(error: unknown, config?: DbConnectionConfig): DatabaseError {
  if (error instanceof DatabaseError) return error;
  const network = describeNetworkError(error, config);
  if (network) return network;
  const e = error as { code?: string; message?: string };
  switch (e?.code) {
    case '28P01':
    case '28000':
      return new DatabaseError('Usuário ou senha inválidos para este servidor.', e.code);
    case '3D000':
      return new DatabaseError(`O banco "${config?.database ?? ''}" não existe neste servidor.`, e.code);
    case '57014':
      return new DatabaseError('Consulta cancelada.', e.code);
    case '25006':
      return new DatabaseError('Esta conexão é somente leitura: o servidor recusou a alteração.', e.code);
  }
  return new DatabaseError(e?.message ?? String(error), e?.code);
}

function clientConfig(config: DbConnectionConfig, password: string, timeoutMs: number): pg.ClientConfig {
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: timeoutMs,
    application_name: 'Rota',
    types,
  };
}

export class PostgresSession implements DbSession {
  private constructor(
    private readonly client: pg.Client,
    private readonly password: string,
    readonly config: DbConnectionConfig,
    readonly info: DbServerInfo,
  ) {}

  static async connect(
    config: DbConnectionConfig,
    password: string,
    options: ConnectOptions = {},
  ): Promise<PostgresSession> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const client = new pg.Client(clientConfig(config, password, timeoutMs));
    // Erros da conexão fora de uma consulta (servidor caiu) não podem derrubar o app.
    client.on('error', () => undefined);
    try {
      await withTimeout(client.connect(), timeoutMs + 1000);
      const { rows } = await client.query<{ version: string; db: string; conn: string }>(
        "SELECT current_setting('server_version') AS version, pg_encoding_to_char(encoding) AS db, current_setting('client_encoding') AS conn FROM pg_database WHERE datname = current_database()",
      );
      const row = rows[0];
      return new PostgresSession(client, password, config, {
        version: `PostgreSQL ${row?.version ?? ''}`.trim(),
        databaseCharset: row?.db ?? '',
        connectionCharset: row?.conn ?? '',
      });
    } catch (error) {
      await client.end().catch(() => undefined);
      throw describePostgresError(error, config);
    }
  }

  async schema(): Promise<DbSchema> {
    try {
      const { rows: relations } = await this.client.query<{ schema: string; name: string; kind: string }>(
        `SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
            AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
          ORDER BY (n.nspname <> 'public'), n.nspname, c.relname`,
      );
      const { rows: columns } = await this.client.query<{
        schema: string;
        rel: string;
        name: string;
        type: string;
        notnull: boolean;
        def: string | null;
      }>(
        `SELECT n.nspname AS schema, c.relname AS rel, a.attname AS name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS notnull,
                pg_get_expr(d.adbin, d.adrelid) AS def
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
            AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
          ORDER BY n.nspname, c.relname, a.attnum`,
      );
      const { rows: keys } = await this.client.query<{
        schema: string;
        rel: string;
        col: string;
        kind: string;
        ref_schema: string | null;
        ref_rel: string | null;
        ref_col: string | null;
      }>(
        `SELECT n.nspname AS schema, c.relname AS rel, a.attname AS col, k.contype AS kind,
                rn.nspname AS ref_schema, rc.relname AS ref_rel, ra.attname AS ref_col
           FROM pg_constraint k
           JOIN pg_class c ON c.oid = k.conrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           CROSS JOIN LATERAL unnest(k.conkey) WITH ORDINALITY AS u(attnum, pos)
           JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.attnum
           LEFT JOIN pg_class rc ON rc.oid = k.confrelid
           LEFT JOIN pg_namespace rn ON rn.oid = rc.relnamespace
           LEFT JOIN pg_attribute ra ON ra.attrelid = k.confrelid AND ra.attnum = k.confkey[u.pos]
          WHERE k.contype IN ('p', 'f') AND n.nspname NOT IN ('pg_catalog', 'information_schema')`,
      );
      const { rows: routines } = await this.client.query<{ name: string }>(
        `SELECT DISTINCT CASE WHEN n.nspname = 'public' THEN p.proname ELSE n.nspname || '.' || p.proname END AS name
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
          ORDER BY 1`,
      );
      const { rows: sequences } = await this.client.query<{ name: string }>(
        `SELECT CASE WHEN n.nspname = 'public' THEN c.relname ELSE n.nspname || '.' || c.relname END AS name
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'S' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          ORDER BY 1`,
      );

      const display = (schema: string, name: string) => (schema === 'public' ? name : `${schema}.${name}`);
      const tables = new Map<string, DbTable>();
      for (const r of relations) {
        const ref =
          r.schema === 'public'
            ? quoteIdentifier('postgres', r.name)
            : `${quoteIdentifier('postgres', r.schema)}.${quoteIdentifier('postgres', r.name)}`;
        tables.set(`${r.schema}.${r.name}`, {
          name: display(r.schema, r.name),
          ref,
          kind: r.kind === 'v' || r.kind === 'm' ? 'view' : 'table',
          columns: [],
        });
      }
      for (const c of columns) {
        tables.get(`${c.schema}.${c.rel}`)?.columns.push({
          name: c.name,
          type: c.type,
          nullable: !c.notnull,
          primaryKey: false,
          ...(c.def ? { defaultValue: c.def } : {}),
        });
      }
      for (const k of keys) {
        const column = tables.get(`${k.schema}.${k.rel}`)?.columns.find((c) => c.name === k.col);
        if (!column) continue;
        if (k.kind === 'p') column.primaryKey = true;
        else if (k.ref_rel && k.ref_col)
          column.references = `${display(k.ref_schema ?? 'public', k.ref_rel)}.${k.ref_col}`;
      }
      return {
        tables: [...tables.values()],
        procedures: routines.map((r) => r.name),
        generators: sequences.map((s) => s.name),
      };
    } catch (error) {
      throw describePostgresError(error, this.config);
    }
  }

  /**
   * Um comando por vez (protocolo estendido recusa vários). Somente leitura:
   * transação READ ONLY desfeita no fim, que bloqueia até nextval().
   */
  async run(sql: string, options: { readOnly: boolean; limit?: number }): Promise<DbQueryResult> {
    const started = Date.now();
    const limit = options.limit ?? DEFAULT_ROW_LIMIT;
    if (options.readOnly) {
      const violation = readOnlyViolation(sql);
      if (violation) throw new DatabaseError(violation);
    }
    let open = false;
    try {
      await this.client.query(options.readOnly ? 'BEGIN TRANSACTION READ ONLY' : 'BEGIN');
      open = true;
      const cursor = this.client.query(new Cursor(sql, [], { rowMode: 'array' }));
      const { rows, result } = await new Promise<{ rows: unknown[][]; result: pg.QueryResult }>(
        (resolve, reject) =>
          cursor.read(limit + 1, (err, rows, result) =>
            err ? reject(err) : resolve({ rows: rows as unknown[][], result: result as pg.QueryResult }),
          ),
      );
      await new Promise<void>((resolve) => cursor.close(() => resolve()));
      await this.client.query(options.readOnly ? 'ROLLBACK' : 'COMMIT');
      open = false;

      const fields = result.fields ?? [];
      if (fields.length === 0)
        return {
          columns: [],
          rows: [],
          truncated: false,
          durationMs: Date.now() - started,
          affected: result.rowCount ?? 0,
        };
      const typeNames = await this.typeNames(fields.map((f) => f.dataTypeID));
      return {
        columns: fields.map((f) => ({
          name: f.name,
          type: typeNames.get(f.dataTypeID) ?? String(f.dataTypeID),
        })),
        rows: rows.slice(0, limit).map((row) => row.map((v): DbValue => toDbValue(v))),
        truncated: rows.length > limit,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      if (open) await this.client.query('ROLLBACK').catch(() => undefined);
      throw describePostgresError(error, this.config);
    }
  }

  private readonly typeCache = new Map<number, string>();

  private async typeNames(oids: number[]): Promise<Map<number, string>> {
    const missing = [...new Set(oids)].filter((o) => !this.typeCache.has(o));
    if (missing.length) {
      const { rows } = await this.client.query<{ oid: number; name: string }>(
        'SELECT oid::int AS oid, format_type(oid, NULL) AS name FROM pg_type WHERE oid = ANY($1)',
        [missing],
      );
      for (const r of rows) this.typeCache.set(r.oid, r.name);
    }
    return this.typeCache;
  }

  /** Cancela pela própria API do PostgreSQL, numa conexão à parte. */
  async cancel(): Promise<void> {
    const pid = (this.client as unknown as { processID?: number }).processID;
    if (!pid) return;
    const other = new pg.Client(clientConfig(this.config, this.password, 5000));
    other.on('error', () => undefined);
    try {
      await other.connect();
      await other.query('SELECT pg_cancel_backend($1)', [pid]);
    } finally {
      await other.end().catch(() => undefined);
    }
  }

  close(): Promise<void> {
    return this.client.end().catch(() => undefined);
  }
}

import sql from 'mssql';
import {
  type ConnectOptions,
  DatabaseError,
  type DbSession,
  describeNetworkError,
  formatDate,
  toDbValue,
  toSafeNumber,
  withTimeout,
} from './common';
import { quoteIdentifier, readOnlyViolation } from './sql';
import type { DbConnectionConfig, DbQueryResult, DbSchema, DbServerInfo, DbTable, DbValue } from './types';
import { DEFAULT_ROW_LIMIT } from './types';

/** Mensagens em português para os erros mais comuns do SQL Server. */
export function describeSqlServerError(error: unknown, config?: DbConnectionConfig): DatabaseError {
  if (error instanceof DatabaseError) return error;
  const e = error as { code?: string; number?: number; message?: string; originalError?: unknown };
  // O motivo de rede vem aninhado (cause, e uma lista com as tentativas IPv4/IPv6).
  const original = e?.originalError as { cause?: { errors?: unknown[] } } | undefined;
  const candidates = [error, original, original?.cause, ...(original?.cause?.errors ?? [])];
  for (const candidate of candidates) {
    const network = describeNetworkError(candidate, config);
    if (network) return network;
  }
  if (e?.code === 'ELOGIN')
    // O SQL Server dá a mesma resposta para senha errada e banco inexistente
    // (para não revelar quais bancos existem).
    return new DatabaseError(
      `Login recusado: usuário ou senha inválidos, ou o banco "${config?.database ?? ''}" não existe ou não está liberado para este usuário.`,
      e.code,
    );
  if (e?.code === 'ETIMEOUT')
    return new DatabaseError(
      `Sem resposta de ${config ? `${config.host}:${config.port}` : 'o servidor'}. Confira a rede, a VPN ou o firewall.`,
      e.code,
    );
  if (e?.code === 'ECANCEL') return new DatabaseError('Consulta cancelada.', e.code);
  return new DatabaseError(e?.message ?? String(error), e?.number ?? e?.code);
}

interface ColumnMeta {
  name: string;
  type?: { declaration?: string };
}

/**
 * Datas chegam como Date com os campos em UTC (useUTC): ler em UTC devolve o
 * que está gravado, sem conversão de fuso.
 */
function toValue(value: unknown, declaration: string): DbValue {
  if (value instanceof Date) {
    if (declaration === 'date') return formatDate(value, 'date', true);
    if (declaration === 'time') return formatDate(value, 'time', true);
    if (declaration === 'datetimeoffset') return value.toISOString();
    return formatDate(value, 'datetime', true);
  }
  if (typeof value === 'string' && declaration === 'bigint') return toSafeNumber(value);
  return toDbValue(value);
}

export class SqlServerSession implements DbSession {
  private current: sql.Request | null = null;

  private constructor(
    private readonly pool: sql.ConnectionPool,
    readonly config: DbConnectionConfig,
    readonly info: DbServerInfo,
  ) {}

  static async connect(
    config: DbConnectionConfig,
    password: string,
    options: ConnectOptions = {},
  ): Promise<SqlServerSession> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const pool = new sql.ConnectionPool({
      server: config.host,
      port: config.port,
      user: config.user,
      password,
      database: config.database,
      connectionTimeout: timeoutMs,
      requestTimeout: 0,
      pool: { max: 1, min: 0 },
      options: {
        encrypt: config.ssl,
        // Servidores de clientes costumam usar certificado próprio.
        trustServerCertificate: true,
        useUTC: true,
        appName: 'Rota',
      },
    });
    pool.on('error', () => undefined);
    try {
      await withTimeout(pool.connect(), timeoutMs + 1000);
      const result = await pool
        .request()
        .query<{ v: string; edition: string; collation: string }>(
          "SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(64)) AS v, CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition, CAST(DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS nvarchar(128)) AS collation",
        );
      const row = result.recordset[0];
      return new SqlServerSession(pool, config, {
        version: `SQL Server ${row?.v ?? ''}`.trim(),
        databaseCharset: row?.collation ?? '',
        connectionCharset: 'UTF-16',
      });
    } catch (error) {
      await pool.close().catch(() => undefined);
      throw describeSqlServerError(error, config);
    }
  }

  async schema(): Promise<DbSchema> {
    try {
      const q = <T>(text: string) =>
        this.pool
          .request()
          .query<T>(text)
          .then((r) => r.recordset);
      const relations = await q<{ schema: string; name: string; type: string }>(
        `SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS name, TABLE_TYPE AS type
           FROM INFORMATION_SCHEMA.TABLES
          ORDER BY CASE WHEN TABLE_SCHEMA = 'dbo' THEN 0 ELSE 1 END, TABLE_SCHEMA, TABLE_NAME`,
      );
      const columns = await q<{
        schema: string;
        rel: string;
        name: string;
        type: string;
        len: number | null;
        prec: number | null;
        scale: number | null;
        nullable: string;
        def: string | null;
      }>(
        `SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS rel, COLUMN_NAME AS name, DATA_TYPE AS type,
                CHARACTER_MAXIMUM_LENGTH AS len, NUMERIC_PRECISION AS prec, NUMERIC_SCALE AS scale,
                IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def
           FROM INFORMATION_SCHEMA.COLUMNS ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`,
      );
      const primary = await q<{ schema: string; rel: string; col: string }>(
        `SELECT k.TABLE_SCHEMA AS [schema], k.TABLE_NAME AS rel, k.COLUMN_NAME AS col
           FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS t
           JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k ON k.CONSTRAINT_NAME = t.CONSTRAINT_NAME AND k.TABLE_SCHEMA = t.TABLE_SCHEMA
          WHERE t.CONSTRAINT_TYPE = 'PRIMARY KEY'`,
      );
      const foreign = await q<{
        schema: string;
        rel: string;
        col: string;
        ref_schema: string;
        ref_rel: string;
        ref_col: string;
      }>(
        `SELECT SCHEMA_NAME(t.schema_id) AS [schema], t.name AS rel, c.name AS col,
                SCHEMA_NAME(rt.schema_id) AS ref_schema, rt.name AS ref_rel, rc.name AS ref_col
           FROM sys.foreign_key_columns f
           JOIN sys.tables t ON t.object_id = f.parent_object_id
           JOIN sys.columns c ON c.object_id = f.parent_object_id AND c.column_id = f.parent_column_id
           JOIN sys.tables rt ON rt.object_id = f.referenced_object_id
           JOIN sys.columns rc ON rc.object_id = f.referenced_object_id AND rc.column_id = f.referenced_column_id`,
      );
      const procedures = await q<{ name: string }>(
        "SELECT CASE WHEN SCHEMA_NAME(schema_id) = 'dbo' THEN name ELSE SCHEMA_NAME(schema_id) + '.' + name END AS name FROM sys.procedures ORDER BY 1",
      );
      const sequences = await q<{ name: string }>(
        "SELECT CASE WHEN SCHEMA_NAME(schema_id) = 'dbo' THEN name ELSE SCHEMA_NAME(schema_id) + '.' + name END AS name FROM sys.sequences ORDER BY 1",
      );

      const display = (schema: string, name: string) => (schema === 'dbo' ? name : `${schema}.${name}`);
      const tables = new Map<string, DbTable>();
      for (const r of relations)
        tables.set(`${r.schema}.${r.name}`, {
          name: display(r.schema, r.name),
          ref:
            r.schema === 'dbo'
              ? quoteIdentifier('sqlserver', r.name)
              : `${quoteIdentifier('sqlserver', r.schema)}.${quoteIdentifier('sqlserver', r.name)}`,
          kind: r.type === 'VIEW' ? 'view' : 'table',
          columns: [],
        });
      for (const c of columns) {
        const size =
          c.len === -1
            ? '(max)'
            : c.len
              ? `(${c.len})`
              : ['decimal', 'numeric'].includes(c.type)
                ? `(${c.prec},${c.scale})`
                : '';
        tables.get(`${c.schema}.${c.rel}`)?.columns.push({
          name: c.name,
          type: `${c.type}${size}`,
          nullable: c.nullable === 'YES',
          primaryKey: false,
          ...(c.def ? { defaultValue: c.def.replace(/^\(+|\)+$/g, '') } : {}),
        });
      }
      for (const p of primary) {
        const column = tables.get(`${p.schema}.${p.rel}`)?.columns.find((c) => c.name === p.col);
        if (column) column.primaryKey = true;
      }
      for (const f of foreign) {
        const column = tables.get(`${f.schema}.${f.rel}`)?.columns.find((c) => c.name === f.col);
        if (column) column.references = `${display(f.ref_schema, f.ref_rel)}.${f.ref_col}`;
      }
      return {
        tables: [...tables.values()],
        procedures: procedures.map((p) => p.name),
        generators: sequences.map((s) => s.name),
      };
    } catch (error) {
      throw describeSqlServerError(error, this.config);
    }
  }

  /**
   * O SQL Server não tem transação somente leitura: a proteção é recusar
   * comandos de escrita antes de executar e, por garantia, desfazer a
   * transação no fim. Para segurança total, use um usuário só de leitura.
   */
  async run(text: string, options: { readOnly: boolean; limit?: number }): Promise<DbQueryResult> {
    const started = Date.now();
    const limit = options.limit ?? DEFAULT_ROW_LIMIT;
    if (options.readOnly) {
      const violation = readOnlyViolation(text);
      if (violation) throw new DatabaseError(violation);
    }
    const tx = new sql.Transaction(this.pool);
    let begun = false;
    try {
      await tx.begin();
      begun = true;
      const result = await this.stream(new sql.Request(tx), text, limit);
      if (options.readOnly) await tx.rollback();
      else await tx.commit();
      begun = false;
      if (!result.columns)
        return {
          columns: [],
          rows: [],
          truncated: false,
          durationMs: Date.now() - started,
          affected: result.affected,
        };
      const declarations = result.columns.map((c) => c.type?.declaration ?? '');
      return {
        columns: result.columns.map((c, i) => ({ name: c.name, type: declarations[i] ?? '' })),
        rows: result.rows.map((row) => row.map((v, i) => toValue(v, declarations[i] ?? ''))),
        truncated: result.truncated,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      if (begun) await tx.rollback().catch(() => undefined);
      throw describeSqlServerError(error, this.config);
    }
  }

  /** Lê em streaming até o limite e cancela o resto no servidor. */
  private stream(
    request: sql.Request,
    text: string,
    limit: number,
  ): Promise<{ columns: ColumnMeta[] | undefined; rows: unknown[][]; truncated: boolean; affected: number }> {
    return new Promise((resolve, reject) => {
      const rows: unknown[][] = [];
      let columns: ColumnMeta[] | undefined;
      let affected = 0;
      let truncated = false;
      request.stream = true;
      request.arrayRowMode = true;
      this.current = request;
      request.on('recordset', (meta: ColumnMeta[]) => {
        // Só o primeiro conjunto de resultados aparece na tela.
        columns ??= meta;
      });
      request.on('row', (row: unknown[]) => {
        if (rows.length < limit) rows.push(row);
        else if (!truncated) {
          truncated = true;
          request.cancel();
        }
      });
      request.on('rowsaffected', (count: number) => {
        affected += count;
      });
      request.on('error', (err: { code?: string }) => {
        if (truncated && err.code === 'ECANCEL') return;
        this.current = null;
        reject(err);
      });
      request.on('done', () => {
        this.current = null;
        resolve({ columns, rows, truncated, affected });
      });
      request.query(text);
    });
  }

  async cancel(): Promise<void> {
    this.current?.cancel();
  }

  close(): Promise<void> {
    return this.pool.close().catch(() => undefined);
  }
}

import mysql from 'mysql2';
import {
  type ConnectOptions,
  DatabaseError,
  type DbSession,
  describeNetworkError,
  readOnlyViolation,
  toDbValue,
  toSafeNumber,
  withTimeout,
} from './common';
import { quoteIdentifier } from './sql';
import type { DbConnectionConfig, DbQueryResult, DbSchema, DbServerInfo, DbTable } from './types';
import { DEFAULT_ROW_LIMIT } from './types';

const ER_ACCESS_DENIED = 1045;
const ER_BAD_DB = 1049;
const ER_QUERY_INTERRUPTED = 1317;
const ER_READ_ONLY_TRANSACTION = 1792;

/** Mensagens em português para os erros mais comuns do MySQL/MariaDB. */
export function describeMysqlError(error: unknown, config?: DbConnectionConfig): DatabaseError {
  if (error instanceof DatabaseError) return error;
  const network = describeNetworkError(error, config);
  if (network) return network;
  const e = error as { errno?: number; message?: string; code?: string };
  switch (e?.errno) {
    case ER_ACCESS_DENIED:
      return new DatabaseError('Usuário ou senha inválidos para este servidor.', e.errno);
    case ER_BAD_DB:
      return new DatabaseError(`O banco "${config?.database ?? ''}" não existe neste servidor.`, e.errno);
    case ER_QUERY_INTERRUPTED:
      return new DatabaseError('Consulta cancelada.', e.errno);
    case ER_READ_ONLY_TRANSACTION:
      return new DatabaseError('Esta conexão é somente leitura: o servidor recusou a alteração.', e.errno);
  }
  return new DatabaseError(e?.message ?? String(error), e?.errno ?? e?.code);
}

function connectionOptions(
  config: DbConnectionConfig,
  password: string,
  timeoutMs: number,
): mysql.ConnectionOptions {
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password,
    database: config.database,
    charset: 'utf8mb4',
    connectTimeout: timeoutMs,
    ...(config.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
    // Datas como o banco escreveu; números grandes e DECIMAL sem perder precisão.
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    multipleStatements: false,
    typeCast(field, next) {
      if (field.type === 'NEWDECIMAL') {
        const text = field.string();
        return text === null ? null : toSafeNumber(text);
      }
      if (field.type === 'JSON') return field.string('utf8');
      return next();
    },
  };
}

type Conn = mysql.Connection;

function query<T>(conn: Conn, sql: string, values: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) =>
    conn.query(sql, values, (err, rows) => (err ? reject(err) : resolve(rows as T[]))),
  );
}

function open(options: mysql.ConnectionOptions): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const conn = mysql.createConnection(options);
    conn.connect((err) => (err ? reject(err) : resolve(conn)));
  });
}

/** Nome do tipo para o cabeçalho do resultado (mysql2 informa o código numérico). */
const TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(mysql.Types as unknown as Record<string, number>).map(([name, code]) => [code, name]),
);

export class MysqlSession implements DbSession {
  private constructor(
    private readonly conn: Conn,
    private readonly password: string,
    readonly config: DbConnectionConfig,
    readonly info: DbServerInfo,
  ) {}

  static async connect(
    config: DbConnectionConfig,
    password: string,
    options: ConnectOptions = {},
  ): Promise<MysqlSession> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    let conn: Conn | undefined;
    try {
      conn = await withTimeout(open(connectionOptions(config, password, timeoutMs)), timeoutMs + 1000);
      conn.on('error', () => undefined);
      const [row] = await query<{ v: string; db: string; conn: string }>(
        conn,
        'SELECT VERSION() AS v, @@character_set_database AS db, @@character_set_connection AS conn',
      );
      const version = row?.v ?? '';
      return new MysqlSession(conn, password, config, {
        version: `${/mariadb/i.test(version) ? 'MariaDB' : 'MySQL'} ${version.split('-')[0]}`.trim(),
        databaseCharset: row?.db ?? '',
        connectionCharset: row?.conn ?? '',
      });
    } catch (error) {
      conn?.destroy();
      throw describeMysqlError(error, config);
    }
  }

  async schema(): Promise<DbSchema> {
    try {
      const relations = await query<{ name: string; type: string }>(
        this.conn,
        `SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`,
      );
      const columns = await query<{
        rel: string;
        name: string;
        type: string;
        nullable: string;
        def: string | null;
        pk: string;
      }>(
        this.conn,
        `SELECT TABLE_NAME AS rel, COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
                COLUMN_DEFAULT AS def, COLUMN_KEY AS pk
           FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
          ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      );
      const foreign = await query<{ rel: string; col: string; ref_rel: string; ref_col: string }>(
        this.conn,
        `SELECT TABLE_NAME AS rel, COLUMN_NAME AS col, REFERENCED_TABLE_NAME AS ref_rel, REFERENCED_COLUMN_NAME AS ref_col
           FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`,
      );
      const routines = await query<{ name: string }>(
        this.conn,
        'SELECT ROUTINE_NAME AS name FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() ORDER BY 1',
      );

      const tables = new Map<string, DbTable>(
        relations.map((r) => [
          r.name,
          {
            name: r.name,
            ref: quoteIdentifier('mysql', r.name),
            kind: r.type === 'VIEW' ? 'view' : 'table',
            columns: [],
          },
        ]),
      );
      for (const c of columns)
        tables.get(c.rel)?.columns.push({
          name: c.name,
          type: c.type,
          nullable: c.nullable === 'YES',
          primaryKey: c.pk === 'PRI',
          ...(c.def !== null ? { defaultValue: c.def } : {}),
        });
      for (const f of foreign) {
        const column = tables.get(f.rel)?.columns.find((c) => c.name === f.col);
        if (column) column.references = `${f.ref_rel}.${f.ref_col}`;
      }
      return { tables: [...tables.values()], procedures: routines.map((r) => r.name), generators: [] };
    } catch (error) {
      throw describeMysqlError(error, this.config);
    }
  }

  /** Somente leitura: transação READ ONLY desfeita no fim (o servidor recusa escrita). */
  async run(sql: string, options: { readOnly: boolean; limit?: number }): Promise<DbQueryResult> {
    const started = Date.now();
    const limit = options.limit ?? DEFAULT_ROW_LIMIT;
    if (options.readOnly) {
      const violation = readOnlyViolation(sql);
      if (violation) throw new DatabaseError(violation);
    }
    let open = false;
    try {
      await query(this.conn, options.readOnly ? 'START TRANSACTION READ ONLY' : 'START TRANSACTION');
      open = true;
      const result = await this.stream(sql, limit);
      await query(this.conn, options.readOnly ? 'ROLLBACK' : 'COMMIT');
      open = false;
      if (!result.fields)
        return {
          columns: [],
          rows: [],
          truncated: false,
          durationMs: Date.now() - started,
          affected: result.affected ?? 0,
        };
      return {
        columns: result.fields.map((f) => ({
          name: f.name,
          type: TYPE_NAMES[f.columnType ?? -1] ?? String(f.columnType),
        })),
        rows: result.rows.map((row) => row.map((v) => toDbValue(v))),
        truncated: result.truncated,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      if (open) await query(this.conn, 'ROLLBACK').catch(() => undefined);
      throw describeMysqlError(error, this.config);
    }
  }

  /** Lê até o limite; passou disso, interrompe a consulta no servidor (KILL QUERY). */
  private stream(
    sql: string,
    limit: number,
  ): Promise<{
    fields: mysql.FieldPacket[] | undefined;
    rows: unknown[][];
    truncated: boolean;
    affected: number | undefined;
  }> {
    return new Promise((resolve, reject) => {
      const rows: unknown[][] = [];
      let fields: mysql.FieldPacket[] | undefined;
      let affected: number | undefined;
      let truncated = false;
      let killing: Promise<void> = Promise.resolve();
      // O KILL vai por outra conexão: só libera a sessão depois que ele terminou,
      // senão ele poderia acertar a próxima consulta.
      const finish = () => void killing.then(() => resolve({ fields, rows, truncated, affected }));
      const q = this.conn.query({ sql, rowsAsArray: true });
      q.on('fields', (f: mysql.FieldPacket[]) => {
        fields = f;
      });
      q.on('result', (row: unknown) => {
        if (Array.isArray(row)) {
          if (rows.length < limit) rows.push(row);
          else if (!truncated) {
            truncated = true;
            killing = this.cancel();
          }
        } else affected = (row as { affectedRows?: number }).affectedRows;
      });
      q.on('error', (err: { errno?: number }) => {
        // Interrompida por nós ao atingir o limite: o que veio basta.
        if (truncated && err.errno === ER_QUERY_INTERRUPTED) finish();
        else void killing.then(() => reject(err));
      });
      q.on('end', finish);
    });
  }

  /** Cancela com KILL QUERY numa conexão à parte. */
  async cancel(): Promise<void> {
    const other = await open(connectionOptions(this.config, this.password, 5000)).catch(() => null);
    if (!other) return;
    other.on('error', () => undefined);
    try {
      await query(other, `KILL QUERY ${Number(this.conn.threadId)}`);
    } catch {
      // A consulta já tinha terminado.
    } finally {
      other.destroy();
    }
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.conn.end(() => resolve()));
  }
}

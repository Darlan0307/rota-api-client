import * as Firebird from 'node-firebird';
import {
  type DbColumn,
  type DbConnectionConfig,
  type DbQueryResult,
  type DbResultColumn,
  type DbSchema,
  type DbServerInfo,
  type DbTable,
  type DbValue,
  DEFAULT_ROW_LIMIT,
} from './types';

/**
 * Sessão com um banco Firebird (2.5 ou mais novo) pelo protocolo de rede,
 * sem cliente instalado. Consultas somente leitura rodam numa transação
 * READ ONLY (o próprio servidor recusa escrita) e, antes, o comando é
 * preparado para conferir que é um SELECT.
 */

// Tipos SQL do Firebird (XSQLVAR.sqltype sem o bit de nulo).
const SQL_TEXT = 452;
const SQL_VARYING = 448;
const SQL_SHORT = 500;
const SQL_LONG = 496;
const SQL_FLOAT = 482;
const SQL_DOUBLE = 480;
const SQL_TIMESTAMP = 510;
const SQL_BLOB = 520;
const SQL_TYPE_TIME = 560;
const SQL_TYPE_DATE = 570;
const SQL_INT64 = 580;
const SQL_BOOLEAN = 32764;

// isc_info_sql_stmt_*
const STMT_SELECT = 1;

const GDS_CANCELLED = 335544794;
const GDS_LOGIN = 335544472;
const GDS_IO = 335544344;
const GDS_READ_ONLY = 335544361;

interface XsqlVar {
  alias: string;
  field?: string;
  type: number;
  subType: number;
  scale: number;
  length: number;
}

export class DatabaseError extends Error {
  constructor(
    message: string,
    readonly code?: string | number,
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

/** Mensagens em português para os erros mais comuns de conexão e consulta. */
export function describeFirebirdError(
  error: unknown,
  config?: Pick<DbConnectionConfig, 'host' | 'port' | 'database'>,
): DatabaseError {
  const e = error as { message?: string; code?: string; gdscode?: number };
  const where = config ? `${config.host}:${config.port}` : 'o servidor';
  const raw = String(e?.message ?? error).split('\n')[0] ?? '';
  switch (e?.code) {
    case 'ECONNREFUSED':
      return new DatabaseError(
        `Nada respondeu em ${where}. O Firebird está rodando e a porta está liberada no firewall?`,
        e.code,
      );
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new DatabaseError(
        `O servidor ${config?.host ?? ''} não foi encontrado. Confira o endereço (e a VPN, se houver).`,
        e.code,
      );
    case 'ETIMEDOUT':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return new DatabaseError(
        `Sem resposta de ${where}. Confira a rede, a VPN ou o túnel até o servidor.`,
        e.code,
      );
    case 'ECONNRESET':
      return new DatabaseError(`A conexão com ${where} caiu.`, e.code);
  }
  switch (e?.gdscode) {
    case GDS_LOGIN:
      return new DatabaseError('Usuário ou senha inválidos para este servidor.', e.gdscode);
    case GDS_IO:
      return new DatabaseError(
        `O banco "${config?.database ?? ''}" não foi encontrado no servidor. Confira o alias (aliases.conf) ou o caminho do arquivo .FDB.`,
        e.gdscode,
      );
    case GDS_CANCELLED:
      return new DatabaseError('Consulta cancelada.', e.gdscode);
    case GDS_READ_ONLY:
      return new DatabaseError('Esta conexão é somente leitura: o servidor recusou a alteração.', e.gdscode);
  }
  return new DatabaseError(raw || 'Erro desconhecido do Firebird.', e?.code ?? e?.gdscode);
}

/** Tira comentários e textos entre aspas para procurar palavras do comando. */
function stripSqlLiterals(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

/**
 * Motivo para recusar o comando numa conexão somente leitura, ou null.
 * GEN_ID e NEXT VALUE FOR alteram generators mesmo em transação READ ONLY.
 */
export function readOnlyViolation(sql: string): string | null {
  const text = stripSqlLiterals(sql);
  if (/\bGEN_ID\s*\(/i.test(text) || /\bNEXT\s+VALUE\s+FOR\b/i.test(text))
    return 'GEN_ID e NEXT VALUE FOR avançam o generator mesmo sem gravar nada, por isso ficam bloqueados nesta conexão somente leitura.';
  return null;
}

const pad = (n: number, size = 2) => String(n).padStart(size, '0');

/** Datas e horas no horário local (o driver entrega Date em UTC). */
function formatValue(value: unknown, type: number): DbValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'function') return '(BLOB binário)';
  if (value instanceof Date) {
    const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    const time = `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
    if (type === SQL_TYPE_DATE) return date;
    if (type === SQL_TYPE_TIME) return time;
    const ms = value.getMilliseconds();
    return `${date} ${time}${ms ? `.${pad(ms, 3)}` : ''}`;
  }
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex').toUpperCase()}`;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value.replace(/ +$/, '');
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

function describeOutput(v: XsqlVar): string {
  const type = v.type & ~1;
  const scaled = v.scale < 0 ? `NUMERIC(${v.scale * -1})` : undefined;
  switch (type) {
    case SQL_TEXT:
      return `CHAR`;
    case SQL_VARYING:
      return 'VARCHAR';
    case SQL_SHORT:
      return scaled ?? 'SMALLINT';
    case SQL_LONG:
      return scaled ?? 'INTEGER';
    case SQL_INT64:
      return scaled ?? 'BIGINT';
    case SQL_FLOAT:
      return 'FLOAT';
    case SQL_DOUBLE:
      return 'DOUBLE';
    case SQL_TIMESTAMP:
      return 'TIMESTAMP';
    case SQL_TYPE_DATE:
      return 'DATE';
    case SQL_TYPE_TIME:
      return 'TIME';
    case SQL_BLOB:
      return v.subType === 1 ? 'BLOB TEXT' : 'BLOB';
    case SQL_BOOLEAN:
      return 'BOOLEAN';
    default:
      return String(type);
  }
}

/** Tipo de uma coluna a partir do RDB$FIELDS (para a árvore do schema). */
export function describeFieldType(f: {
  type: number;
  subType: number | null;
  length: number | null;
  charLength: number | null;
  precision: number | null;
  scale: number | null;
}): string {
  const scale = f.scale ?? 0;
  if (scale < 0 && [7, 8, 16].includes(f.type))
    return `${f.subType === 2 ? 'DECIMAL' : 'NUMERIC'}(${f.precision ?? 18},${-scale})`;
  switch (f.type) {
    case 7:
      return 'SMALLINT';
    case 8:
      return 'INTEGER';
    case 16:
      return 'BIGINT';
    case 10:
      return 'FLOAT';
    case 27:
      return 'DOUBLE PRECISION';
    case 12:
      return 'DATE';
    case 13:
      return 'TIME';
    case 35:
      return 'TIMESTAMP';
    case 14:
      return `CHAR(${f.charLength ?? f.length})`;
    case 37:
      return `VARCHAR(${f.charLength ?? f.length})`;
    case 261:
      return f.subType === 1 ? 'BLOB SUB_TYPE TEXT' : 'BLOB';
    case 23:
      return 'BOOLEAN';
    default:
      return `TIPO ${f.type}`;
  }
}

function attach(options: Firebird.Options): Promise<Firebird.Database> {
  return new Promise((resolve, reject) =>
    Firebird.attach(options, (err, db) => (err ? reject(err) : resolve(db))),
  );
}

function query<T>(db: Firebird.Database | Firebird.Transaction, sql: string): Promise<T[]> {
  return new Promise((resolve, reject) =>
    db.query(sql, [], (err, rows: T[]) => (err ? reject(err) : resolve(rows))),
  );
}

export interface FirebirdConnectOptions {
  /** Tempo máximo para conectar (padrão 10 s). */
  timeoutMs?: number;
}

export class FirebirdSession {
  private constructor(
    private readonly db: Firebird.Database,
    readonly config: DbConnectionConfig,
    readonly info: DbServerInfo,
  ) {}

  /**
   * Conecta. Com charset "auto", lê o charset do banco: NONE vira WIN1252
   * (bancos antigos gravam os bytes do Windows), os demais conectam em UTF8
   * e o servidor converte.
   */
  static async connect(
    config: DbConnectionConfig,
    password: string,
    options: FirebirdConnectOptions = {},
  ): Promise<FirebirdSession> {
    const base: Firebird.Options = {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password,
      blobAsText: true,
      numericMode: 'safe',
      lowercase_keys: false,
    };
    const open = async (encoding: Firebird.SupportedCharacterSet) => {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })),
          options.timeoutMs ?? 10_000,
        );
      });
      try {
        return await Promise.race([attach({ ...base, encoding }), timeout]);
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      let encoding: Firebird.SupportedCharacterSet = config.charset === 'auto' ? 'UTF8' : config.charset;
      let db = await open(encoding);
      const [row] = await query<{ CS: string | null }>(
        db,
        'SELECT RDB$CHARACTER_SET_NAME AS CS FROM RDB$DATABASE',
      );
      const databaseCharset = (row?.CS ?? 'NONE').trim() || 'NONE';
      if (config.charset === 'auto' && databaseCharset === 'NONE') {
        db.detach();
        encoding = 'WIN1252';
        db = await open(encoding);
      }
      const [version] = await query<{ V: string | null }>(
        db,
        "SELECT RDB$GET_CONTEXT('SYSTEM', 'ENGINE_VERSION') AS V FROM RDB$DATABASE",
      );
      return new FirebirdSession(db, config, {
        databaseCharset,
        connectionCharset: encoding,
        version: version?.V?.trim() ?? '',
      });
    } catch (error) {
      throw describeFirebirdError(error, config);
    }
  }

  private transaction(readOnly: boolean): Promise<Firebird.Transaction> {
    const isolation = readOnly
      ? Firebird.ISOLATION_READ_COMMITTED_READ_ONLY
      : Firebird.ISOLATION_READ_COMMITTED;
    return new Promise((resolve, reject) =>
      this.db.transaction(isolation, (err, t) => (err ? reject(err) : resolve(t))),
    );
  }

  /** Tabelas, views (com colunas, PK e FK), procedures e generators. */
  async schema(): Promise<DbSchema> {
    const t = await this.transaction(true);
    try {
      const relations = await query<{ NAME: string; IS_VIEW: number }>(
        t,
        `SELECT TRIM(R.RDB$RELATION_NAME) AS NAME, IIF(R.RDB$VIEW_BLR IS NULL, 0, 1) AS IS_VIEW
           FROM RDB$RELATIONS R
          WHERE COALESCE(R.RDB$SYSTEM_FLAG, 0) = 0
          ORDER BY 1`,
      );
      const fields = await query<{
        REL: string;
        NAME: string;
        TYPE: number;
        SUB: number | null;
        LEN: number | null;
        CHARLEN: number | null;
        PREC: number | null;
        SCALE: number | null;
        NOTNULL: number | null;
        DEF: string | null;
      }>(
        t,
        `SELECT TRIM(RF.RDB$RELATION_NAME) AS REL, TRIM(RF.RDB$FIELD_NAME) AS NAME,
                F.RDB$FIELD_TYPE AS TYPE, F.RDB$FIELD_SUB_TYPE AS SUB, F.RDB$FIELD_LENGTH AS LEN,
                F.RDB$CHARACTER_LENGTH AS CHARLEN, F.RDB$FIELD_PRECISION AS PREC, F.RDB$FIELD_SCALE AS SCALE,
                COALESCE(RF.RDB$NULL_FLAG, F.RDB$NULL_FLAG) AS NOTNULL,
                CAST(SUBSTRING(COALESCE(RF.RDB$DEFAULT_SOURCE, F.RDB$DEFAULT_SOURCE) FROM 1 FOR 200) AS VARCHAR(200)) AS DEF
           FROM RDB$RELATION_FIELDS RF
           JOIN RDB$FIELDS F ON F.RDB$FIELD_NAME = RF.RDB$FIELD_SOURCE
           JOIN RDB$RELATIONS R ON R.RDB$RELATION_NAME = RF.RDB$RELATION_NAME
          WHERE COALESCE(R.RDB$SYSTEM_FLAG, 0) = 0
          ORDER BY RF.RDB$RELATION_NAME, RF.RDB$FIELD_POSITION`,
      );
      const keys = await query<{
        REL: string;
        FIELD: string;
        KIND: string;
        REF_REL: string | null;
        REF_FIELD: string | null;
      }>(
        t,
        `SELECT TRIM(RC.RDB$RELATION_NAME) AS REL, TRIM(S.RDB$FIELD_NAME) AS FIELD, TRIM(RC.RDB$CONSTRAINT_TYPE) AS KIND,
                TRIM(PK.RDB$RELATION_NAME) AS REF_REL, TRIM(PS.RDB$FIELD_NAME) AS REF_FIELD
           FROM RDB$RELATION_CONSTRAINTS RC
           JOIN RDB$INDEX_SEGMENTS S ON S.RDB$INDEX_NAME = RC.RDB$INDEX_NAME
           LEFT JOIN RDB$REF_CONSTRAINTS REF ON REF.RDB$CONSTRAINT_NAME = RC.RDB$CONSTRAINT_NAME
           LEFT JOIN RDB$RELATION_CONSTRAINTS PK ON PK.RDB$CONSTRAINT_NAME = REF.RDB$CONST_NAME_UQ
           LEFT JOIN RDB$INDEX_SEGMENTS PS ON PS.RDB$INDEX_NAME = PK.RDB$INDEX_NAME AND PS.RDB$FIELD_POSITION = S.RDB$FIELD_POSITION
          WHERE RC.RDB$CONSTRAINT_TYPE IN ('PRIMARY KEY', 'FOREIGN KEY')`,
      );
      const procedures = await query<{ NAME: string }>(
        t,
        'SELECT TRIM(RDB$PROCEDURE_NAME) AS NAME FROM RDB$PROCEDURES WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 ORDER BY 1',
      );
      const generators = await query<{ NAME: string }>(
        t,
        'SELECT TRIM(RDB$GENERATOR_NAME) AS NAME FROM RDB$GENERATORS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 ORDER BY 1',
      );

      const tables = new Map<string, DbTable>(
        relations.map((r) => [r.NAME, { name: r.NAME, kind: r.IS_VIEW ? 'view' : 'table', columns: [] }]),
      );
      for (const f of fields) {
        const column: DbColumn = {
          name: f.NAME,
          type: describeFieldType({
            type: f.TYPE,
            subType: f.SUB,
            length: f.LEN,
            charLength: f.CHARLEN,
            precision: f.PREC,
            scale: f.SCALE,
          }),
          nullable: !f.NOTNULL,
          primaryKey: false,
        };
        const def = f.DEF?.replace(/^\s*DEFAULT\s+/i, '').trim();
        if (def) column.defaultValue = def;
        tables.get(f.REL)?.columns.push(column);
      }
      for (const k of keys) {
        const column = tables.get(k.REL)?.columns.find((c) => c.name === k.FIELD);
        if (!column) continue;
        if (k.KIND === 'PRIMARY KEY') column.primaryKey = true;
        else if (k.REF_REL && k.REF_FIELD) column.references = `${k.REF_REL}.${k.REF_FIELD}`;
      }
      return {
        tables: [...tables.values()],
        procedures: procedures.map((p) => p.NAME),
        generators: generators.map((g) => g.NAME),
      };
    } catch (error) {
      throw describeFirebirdError(error, this.config);
    } finally {
      t.rollback();
    }
  }

  /**
   * Executa um comando. Somente leitura: precisa ser SELECT e roda em
   * transação READ ONLY. Lê no máximo `limit` linhas.
   */
  async run(sql: string, options: { readOnly: boolean; limit?: number }): Promise<DbQueryResult> {
    const started = Date.now();
    const limit = options.limit ?? DEFAULT_ROW_LIMIT;
    if (options.readOnly) {
      const violation = readOnlyViolation(sql);
      if (violation) throw new DatabaseError(violation);
    }
    const t = await this.transaction(options.readOnly);
    let committed = false;
    try {
      const statement = await new Promise<Firebird.Statement & { type: number; output?: XsqlVar[] }>(
        (resolve, reject) =>
          t.newStatement(sql, (err, s) =>
            err ? reject(err) : resolve(s as Firebird.Statement & { type: number }),
          ),
      );
      const output = statement.output ?? [];
      const isSelect = statement.type === STMT_SELECT;
      await new Promise<void>((resolve) => statement.release(() => resolve()));

      if (!isSelect) {
        if (options.readOnly)
          throw new DatabaseError('Esta conexão é somente leitura: só consultas SELECT são permitidas.');
        const result = await t.queryAsync(sql, [], { withMeta: true });
        await new Promise<void>((resolve, reject) => t.commit((err) => (err ? reject(err) : resolve())));
        committed = true;
        return {
          columns: [],
          rows: [],
          truncated: false,
          durationMs: Date.now() - started,
          affected: result.affectedRows,
        };
      }

      const columns: DbResultColumn[] = output.map((v) => ({
        name: v.alias || v.field || '?',
        type: describeOutput(v),
      }));
      const types = output.map((v) => v.type & ~1);
      const rows: DbValue[][] = [];
      let truncated = false;
      const stream = t.queryStream(sql, [], { asObject: false });
      for await (const raw of stream as AsyncIterable<unknown[]>) {
        if (rows.length === limit) {
          truncated = true;
          stream.destroy();
          break;
        }
        rows.push(raw.map((value, i) => formatValue(value, types[i] ?? 0)));
      }
      return { columns, rows, truncated, durationMs: Date.now() - started };
    } catch (error) {
      throw error instanceof DatabaseError ? error : describeFirebirdError(error, this.config);
    } finally {
      if (!committed) t.rollback();
    }
  }

  /** Cancela o que estiver rodando nesta conexão. */
  cancel(): Promise<void> {
    return new Promise((resolve) => this.db.cancel(() => resolve()));
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.db.detach(() => resolve()));
  }
}

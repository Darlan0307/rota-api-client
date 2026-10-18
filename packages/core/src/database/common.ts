import type { DbConnectionConfig, DbQueryResult, DbSchema, DbServerInfo, DbValue } from './types';

/** Sessão aberta com um banco, igual para todos os motores. */
export interface DbSession {
  readonly config: DbConnectionConfig;
  readonly info: DbServerInfo;
  schema(): Promise<DbSchema>;
  /** Somente leitura: só consultas, e o banco recusa escrita quando sabe fazer isso. */
  run(sql: string, options: { readOnly: boolean; limit?: number }): Promise<DbQueryResult>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}

export interface ConnectOptions {
  /** Tempo máximo para conectar (padrão 10 s). */
  timeoutMs?: number;
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

/** Erros de rede comuns a todos os motores, em português; undefined se não for de rede. */
export function describeNetworkError(
  error: unknown,
  config?: Pick<DbConnectionConfig, 'host' | 'port'>,
): DatabaseError | undefined {
  const code = (error as { code?: string })?.code;
  const where = config ? `${config.host}:${config.port}` : 'o servidor';
  switch (code) {
    case 'ECONNREFUSED':
      return new DatabaseError(
        `Nada respondeu em ${where}. O banco está rodando e a porta está liberada no firewall?`,
        code,
      );
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new DatabaseError(
        `O servidor ${config?.host ?? ''} não foi encontrado. Confira o endereço (e a VPN, se houver).`,
        code,
      );
    case 'ETIMEDOUT':
    case 'ETIMEOUT':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return new DatabaseError(`Sem resposta de ${where}. Confira a rede, a VPN ou o firewall.`, code);
    case 'ECONNRESET':
    case 'EPIPE':
      return new DatabaseError(`A conexão com ${where} caiu.`, code);
  }
  return undefined;
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Texto numérico vira número só quando não perde nada (dinheiro e BIGINT grandes ficam exatos). */
export function toSafeNumber(text: string): number | string {
  const n = Number(text);
  if (!Number.isFinite(n)) return text;
  const digits = text.replace(/[-+.]/g, '').replace(/^0+/, '');
  return digits.length <= 15 ? n : text;
}

const pad = (n: number, size = 2) => String(n).padStart(size, '0');

/** Data como texto; `utc` lê os campos em UTC (drivers que entregam a hora "crua" como UTC). */
export function formatDate(value: Date, kind: 'date' | 'time' | 'datetime', utc = false): string {
  const get = utc
    ? {
        y: value.getUTCFullYear(),
        mo: value.getUTCMonth(),
        d: value.getUTCDate(),
        h: value.getUTCHours(),
        mi: value.getUTCMinutes(),
        s: value.getUTCSeconds(),
        ms: value.getUTCMilliseconds(),
      }
    : {
        y: value.getFullYear(),
        mo: value.getMonth(),
        d: value.getDate(),
        h: value.getHours(),
        mi: value.getMinutes(),
        s: value.getSeconds(),
        ms: value.getMilliseconds(),
      };
  const date = `${get.y}-${pad(get.mo + 1)}-${pad(get.d)}`;
  const time = `${pad(get.h)}:${pad(get.mi)}:${pad(get.s)}${get.ms ? `.${pad(get.ms, 3)}` : ''}`;
  if (kind === 'date') return date;
  if (kind === 'time') return time;
  return `${date} ${time}`;
}

/** Converte o que os drivers devolvem em algo exibível. */
export function toDbValue(value: unknown): DbValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex').toUpperCase()}`;
  if (value instanceof Date) return formatDate(value, 'datetime');
  if (typeof value === 'function') return '(BLOB binário)';
  return JSON.stringify(value);
}

/** Tira comentários e textos entre aspas para procurar palavras do comando. */
export function stripSqlLiterals(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/`(?:[^`]|``)*`/g, '``')
    .replace(/\[[^\]]*\]/g, '[]');
}

const READ_START = /^\s*\(*\s*(SELECT|WITH|SHOW|DESCRIBE|DESC|EXPLAIN|VALUES|TABLE)\b/i;

/** Palavras que alteram dados, estrutura ou permissões (ou executam código). */
const WRITE_WORDS =
  /\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|REPLACE\s+INTO|DROP|ALTER|CREATE|TRUNCATE|RENAME|GRANT|REVOKE|DENY|EXEC|EXECUTE|CALL|DO|COPY|LOAD|IMPORT|BACKUP|RESTORE|DBCC|SHUTDOWN|KILL|VACUUM|REINDEX|CLUSTER|LOCK|INTO|OPENROWSET|OPENQUERY|OPENDATASOURCE|BULK|SET\s+TRANSACTION|COMMIT|ROLLBACK|BEGIN|SAVEPOINT|nextval|setval)\b|\b(sp|xp)_\w+/i;

/**
 * Motivo para recusar um comando numa conexão somente leitura (null = pode).
 * Camada extra além da transação READ ONLY do banco, e a única proteção do
 * lado do Rota no SQL Server, que não tem transação somente leitura.
 */
export function readOnlyViolation(sql: string): string | null {
  const text = stripSqlLiterals(sql);
  if (!READ_START.test(text))
    return 'Esta conexão é somente leitura: só consultas (SELECT, WITH, SHOW, EXPLAIN) são permitidas.';
  const word = WRITE_WORDS.exec(text)?.[0];
  if (word)
    return `Esta conexão é somente leitura: "${word.toUpperCase()}" não é permitido aqui (pode alterar o banco).`;
  return null;
}

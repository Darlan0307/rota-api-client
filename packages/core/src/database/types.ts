/**
 * Conexões com bancos de dados (Firebird, PostgreSQL, MySQL/MariaDB e SQL
 * Server). Tipos sem dependências de Node (usados também pelo renderer).
 */

export type DbEngine = 'firebird' | 'postgres' | 'mysql' | 'sqlserver';

/** Produção começa somente leitura; local e teste podem liberar escrita. */
export type DbEnvironment = 'local' | 'teste' | 'producao';

/** "auto": lê o charset do banco; NONE (comum em sistemas antigos) vira WIN1252. */
export type FirebirdCharset = 'auto' | 'UTF8' | 'WIN1252' | 'ISO8859_1' | 'NONE';

export interface DbConnectionConfig {
  id: string;
  name: string;
  engine: DbEngine;
  host: string;
  port: number;
  /**
   * Firebird: alias (ex.: LOJA) ou caminho do arquivo no servidor.
   * Demais: nome do banco.
   */
  database: string;
  /** Usado quando a conexão não usa uma credencial salva. */
  user: string;
  /** Credencial salva (usuário e senha reaproveitados entre conexões). */
  credentialId: string | null;
  /** Só Firebird. */
  charset: FirebirdCharset;
  /** Conexão criptografada (TLS). Não existe no Firebird 2.5. */
  ssl: boolean;
  environment: DbEnvironment;
  readOnly: boolean;
}

export interface DbEngineInfo {
  id: DbEngine;
  label: string;
  /** Sigla curta para listas. */
  short: string;
  defaultPort: number;
  defaultUser: string;
  databaseLabel: string;
  databaseHint: string;
  databasePlaceholder: string;
  /** O servidor garante a somente leitura (transação READ ONLY). */
  serverReadOnly: boolean;
}

export const DB_ENGINES: readonly DbEngineInfo[] = [
  {
    id: 'firebird',
    label: 'Firebird',
    short: 'FB',
    defaultPort: 3050,
    defaultUser: 'SYSDBA',
    databaseLabel: 'Banco',
    databaseHint: 'O alias configurado no servidor (aliases.conf) ou o caminho do arquivo .FDB no servidor.',
    databasePlaceholder: 'Ex.: LOJA ou C:\\Dados\\LOJA.FDB',
    serverReadOnly: true,
  },
  {
    id: 'postgres',
    label: 'PostgreSQL',
    short: 'PG',
    defaultPort: 5432,
    defaultUser: 'postgres',
    databaseLabel: 'Banco',
    databaseHint: 'O nome do banco (database).',
    databasePlaceholder: 'Ex.: loja',
    serverReadOnly: true,
  },
  {
    id: 'mysql',
    label: 'MySQL / MariaDB',
    short: 'MY',
    defaultPort: 3306,
    defaultUser: 'root',
    databaseLabel: 'Banco',
    databaseHint: 'O nome do banco (schema).',
    databasePlaceholder: 'Ex.: loja',
    serverReadOnly: true,
  },
  {
    id: 'sqlserver',
    label: 'SQL Server',
    short: 'MS',
    defaultPort: 1433,
    defaultUser: 'sa',
    databaseLabel: 'Banco',
    databaseHint: 'O nome do banco (database).',
    databasePlaceholder: 'Ex.: Loja',
    serverReadOnly: false,
  },
];

export function engineInfo(engine: DbEngine): DbEngineInfo {
  return DB_ENGINES.find((e) => e.id === engine) ?? (DB_ENGINES[0] as DbEngineInfo);
}

/** Usuário e senha reaproveitados por várias conexões (ex.: o mesmo SYSDBA em vários servidores). */
export interface DbCredential {
  id: string;
  name: string;
  user: string;
}

export type DbConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface DbConnectionView {
  config: DbConnectionConfig;
  /** Há senha salva (da conexão ou da credencial usada). */
  hasPassword: boolean;
  status: DbConnectionStatus;
  info: DbServerInfo | null;
  error: string | null;
  /** Uma consulta está rodando (pode ser cancelada). */
  running: boolean;
}

export interface DbCredentialView extends DbCredential {
  hasPassword: boolean;
  /** Quantas conexões usam esta credencial. */
  usedBy: number;
}

export interface DbState {
  connections: DbConnectionView[];
  credentials: DbCredentialView[];
}

/** Rótulos dos ambientes, na ordem de exibição. */
export const DB_ENVIRONMENTS: readonly { id: DbEnvironment; label: string }[] = [
  { id: 'local', label: 'Local' },
  { id: 'teste', label: 'Teste' },
  { id: 'producao', label: 'Produção' },
];

export interface DbColumn {
  name: string;
  /** Tipo legível (ex.: VARCHAR(60), NUMERIC(15,2)). */
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  /** Tabela.coluna referenciada (chave estrangeira). */
  references?: string;
  defaultValue?: string;
}

export interface DbTable {
  /** Nome exibido (com o schema quando não é o padrão, ex.: vendas.pedidos). */
  name: string;
  /** Como escrever no SQL (com aspas quando precisa). */
  ref: string;
  kind: 'table' | 'view';
  columns: DbColumn[];
}

export interface DbSchema {
  tables: DbTable[];
  procedures: string[];
  /** Generators (Firebird) ou sequences. */
  generators: string[];
}

export interface DbResultColumn {
  name: string;
  type: string;
}

/** Valores já prontos para exibir: datas como texto, números grandes como texto exato. */
export type DbValue = string | number | boolean | null;

export interface DbQueryResult {
  columns: DbResultColumn[];
  rows: DbValue[][];
  /** Havia mais linhas que o limite. */
  truncated: boolean;
  durationMs: number;
  /** Linhas afetadas (comandos que não são consulta, com escrita liberada). */
  affected?: number;
}

export interface DbServerInfo {
  /** Produto e versão (ex.: "Firebird 2.5.9", "PostgreSQL 16.4"). */
  version: string;
  /** Charset ou collation do banco ("" quando não se aplica). */
  databaseCharset: string;
  /** Charset usado na conexão. */
  connectionCharset: string;
}

/** Consulta executada numa conexão (histórico local, só nesta máquina). */
export interface DbHistoryEntry {
  id: string;
  /** ISO 8601. */
  at: string;
  sql: string;
  durationMs: number;
  /** Linhas lidas (consultas) ou afetadas (comandos). */
  rows?: number;
  affected?: number;
  error?: string;
}

export const DEFAULT_FIREBIRD_PORT = 3050;
export const DEFAULT_ROW_LIMIT = 500;

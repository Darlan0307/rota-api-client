/**
 * Conexões com bancos de dados (por enquanto, Firebird). Tipos sem
 * dependências de Node (usados também pelo renderer).
 */

export type DbEngine = 'firebird';

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
  /** Alias (ex.: LOJA) ou caminho do arquivo no servidor (ex.: C:\Dados\LOJA.FDB). */
  database: string;
  /** Usado quando a conexão não usa uma credencial salva. */
  user: string;
  /** Credencial salva (usuário e senha reaproveitados entre conexões). */
  credentialId: string | null;
  charset: FirebirdCharset;
  environment: DbEnvironment;
  readOnly: boolean;
}

/** Usuário e senha reaproveitados por várias conexões (ex.: SYSDBA padrão dos clientes). */
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
  name: string;
  kind: 'table' | 'view';
  columns: DbColumn[];
}

export interface DbSchema {
  tables: DbTable[];
  procedures: string[];
  generators: string[];
}

export interface DbResultColumn {
  name: string;
  type: string;
}

/** Valores já prontos para exibir: datas no horário local, BIGINT exato como texto. */
export type DbValue = string | number | boolean | null;

export interface DbQueryResult {
  columns: DbResultColumn[];
  rows: DbValue[][];
  /** Havia mais linhas que o limite. */
  truncated: boolean;
  durationMs: number;
  /** Linhas afetadas (comandos que não são SELECT, com escrita liberada). */
  affected?: number;
}

export interface DbServerInfo {
  /** Charset declarado no banco. */
  databaseCharset: string;
  /** Charset usado na conexão (depois do "auto"). */
  connectionCharset: string;
  version: string;
}

export const DEFAULT_FIREBIRD_PORT = 3050;
export const DEFAULT_ROW_LIMIT = 500;

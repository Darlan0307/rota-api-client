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
  user: string;
  charset: FirebirdCharset;
  environment: DbEnvironment;
  readOnly: boolean;
}

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

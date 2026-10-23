import type { DbEngine } from './types';

/** Campos de conexão lidos de uma URL ou connection string. Só vem o que estava no texto. */
export interface ParsedConnection {
  engine?: DbEngine;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  /** Avisos para o usuário (ex.: login do Windows, que o Rota não usa). */
  warnings: string[];
}

const SCHEMES: Record<string, DbEngine> = {
  postgres: 'postgres',
  postgresql: 'postgres',
  pgsql: 'postgres',
  mysql: 'mysql',
  mariadb: 'mysql',
  sqlserver: 'sqlserver',
  mssql: 'sqlserver',
  firebird: 'firebird',
  firebirdsql: 'firebird',
};

/**
 * Lê os formatos mais comuns:
 * - URL: `postgresql://usuario:senha@servidor:5432/banco?sslmode=require` (também mysql, sqlserver, firebird);
 * - JDBC: `jdbc:postgresql://...` e `jdbc:sqlserver://servidor:1433;databaseName=banco;user=...`;
 * - chave=valor do .NET/Npgsql/MySQL: `Server=servidor,1433;Database=banco;User Id=...;Password=...`;
 * - Firebird clássico: `servidor/3050:C:\Dados\LOJA.FDB` ou `servidor:ALIAS`.
 */
export function parseConnectionString(input: string): ParsedConnection {
  const text = input.trim().replace(/^["']|["']$/g, '');
  if (!text) throw new Error('Cole uma URL ou connection string.');
  const withoutJdbc = text.replace(/^jdbc:/i, '');
  const scheme = /^([a-z][\w+.-]*):\/\//i.exec(withoutJdbc)?.[1];
  if (scheme) return parseUrl(withoutJdbc, scheme);
  if (text.includes('=')) return parseKeyValue(text);
  const firebird = parseFirebirdClassic(text);
  if (firebird) return firebird;
  throw new Error(
    'Formato não reconhecido. Use uma URL (ex.: postgresql://usuario:senha@servidor:5432/banco) ou uma connection string com Server=...;Database=...',
  );
}

function parseUrl(text: string, scheme: string): ParsedConnection {
  // "postgresql+psycopg2" (SQLAlchemy), "mysql+pymysql"...
  const engine = SCHEMES[scheme.toLowerCase().split('+')[0] ?? ''];
  if (!engine) throw new Error(`Tipo de banco "${scheme}" não suportado pelo Rota.`);
  const result: ParsedConnection = { engine, warnings: [] };

  let rest = text.slice(scheme.length + 3);
  // jdbc:sqlserver://servidor:1433;databaseName=x;user=y — propriedades depois de ";".
  const semicolon = rest.indexOf(';');
  if (engine === 'sqlserver' && semicolon >= 0) {
    Object.assign(result, fromPairs(rest.slice(semicolon + 1), result.warnings));
    rest = rest.slice(0, semicolon);
  }

  let url: URL;
  try {
    // Esquema neutro: o parser de URL trata esquemas desconhecidos sem normalizar host e caminho.
    url = new URL(`rota://${rest}`);
  } catch {
    throw new Error(
      'URL de conexão inválida. Confira se há caracteres especiais na senha sem codificar (ex.: @ vira %40).',
    );
  }
  // Instância nomeada do SQL Server (servidor\SQLEXPRESS) não passa pelo parser de URL.
  if (url.hostname) result.host = decode(url.hostname).replace(/^\[|\]$/g, '');
  if (url.port) result.port = Number(url.port);
  if (url.username) result.user = decode(url.username);
  if (url.password) result.password = decode(url.password);
  const path = decode(url.pathname.replace(/^\//, ''));
  if (path) result.database = engine === 'firebird' ? path : (path.split('/')[0] ?? path);

  for (const [key, value] of url.searchParams) applyParam(result, key, value);
  return result;
}

function parseKeyValue(text: string): ParsedConnection {
  const result: ParsedConnection = { warnings: [] };
  Object.assign(result, fromPairs(text, result.warnings));
  const keys = new Set(splitPairs(text).map(([k]) => k));
  // Palpite do tipo pelo vocabulário de cada driver.
  if (
    ['initial catalog', 'data source', 'encrypt', 'trustservercertificate', 'integrated security'].some((k) =>
      keys.has(k),
    ) ||
    /^tcp:/i.test(text.match(/(?:server|data source)\s*=\s*([^;]*)/i)?.[1] ?? '')
  ) {
    result.engine = 'sqlserver';
  } else if (keys.has('host') && (keys.has('username') || keys.has('ssl mode') || keys.has('sslmode'))) {
    result.engine = 'postgres';
  } else if (keys.has('uid') || keys.has('pwd')) {
    // Uid/Pwd: MySQL Connector, ou ODBC do SQL Server ("Driver={ODBC Driver 18 for SQL Server}").
    result.engine = /sql server/i.test(text) ? 'sqlserver' : 'mysql';
  }
  if (result.host === undefined && result.database === undefined && result.user === undefined) {
    throw new Error('Não encontrei servidor, banco nem usuário nessa connection string.');
  }
  return result;
}

function splitPairs(text: string): [key: string, value: string][] {
  return text
    .split(';')
    .map((part) => {
      const eq = part.indexOf('=');
      if (eq < 0) return null;
      const key = part.slice(0, eq).trim().toLowerCase().replace(/\s+/g, ' ');
      const value = part
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      return key ? ([key, value] as [string, string]) : null;
    })
    .filter((p): p is [string, string] => p !== null);
}

function fromPairs(text: string, warnings: string[]): Omit<ParsedConnection, 'warnings'> {
  const result: ParsedConnection = { warnings };
  for (const [key, value] of splitPairs(text)) applyParam(result, key, value);
  return result;
}

const TRUE =
  /^(true|yes|1|require|required|mandatory|strict|verify-ca|verify-full|verify_ca|verify_identity|verifyca|verifyfull)$/i;
const FALSE = /^(false|no|0|disable|disabled|none|optional|prefer|preferred|allow)$/i;

function applyParam(result: ParsedConnection, rawKey: string, value: string): void {
  const key = rawKey.toLowerCase().replace(/[\s_-]+/g, '');
  switch (key) {
    case 'server':
    case 'host':
    case 'datasource':
    case 'address':
    case 'addr':
    case 'networkaddress':
    case 'hostname': {
      // SQL Server: "tcp:servidor,1433"; outros: "servidor:porta".
      const clean = value.replace(/^tcp:/i, '');
      const match = /^(.+?)[,:](\d{1,5})$/.exec(clean);
      const host = match?.[1] ?? clean;
      if (match?.[2]) result.port = Number(match[2]);
      const instance = host.indexOf('\\');
      if (instance >= 0) {
        result.warnings.push(
          `Instância nomeada (${host.slice(instance + 1)}): o Rota conecta pela porta. Confira a porta TCP da instância (veja o guia do SQL Server).`,
        );
      }
      result.host = instance >= 0 ? host.slice(0, instance) : host;
      if (result.host === '.' || /^\(local\)$/i.test(result.host)) result.host = 'localhost';
      break;
    }
    case 'port':
      if (/^\d{1,5}$/.test(value)) result.port = Number(value);
      break;
    case 'database':
    case 'databasename':
    case 'initialcatalog':
    case 'dbname':
    case 'db':
      result.database = value;
      break;
    case 'user':
    case 'userid':
    case 'uid':
    case 'username':
      result.user = value;
      break;
    case 'password':
    case 'pwd':
      result.password = value;
      break;
    case 'ssl':
    case 'sslmode':
    case 'encrypt':
    case 'usessl':
    case 'sslaccept':
      if (TRUE.test(value) || (key === 'sslaccept' && value === 'strict')) result.ssl = true;
      else if (FALSE.test(value) || key === 'sslaccept') result.ssl = false;
      // PlanetScale e afins: ssl={"rejectUnauthorized":true}
      else if (value.startsWith('{')) result.ssl = true;
      break;
    case 'integratedsecurity':
    case 'trustedconnection':
      if (TRUE.test(value) || /^sspi$/i.test(value)) {
        result.warnings.push(
          'A connection string usa o login do Windows, que o Rota não suporta: informe um usuário e senha do SQL Server.',
        );
      }
      break;
  }
}

/** `servidor/3050:C:\Dados\LOJA.FDB`, `servidor:C:\Dados\LOJA.FDB` ou `servidor:ALIAS`. */
function parseFirebirdClassic(text: string): ParsedConnection | null {
  // Só o caminho (C:\Dados\LOJA.FDB): banco na própria máquina.
  if (/^[a-z]:[\\/]/i.test(text)) {
    return { engine: 'firebird', host: 'localhost', database: text, warnings: [] };
  }
  const match = /^([^/:\\\s]+)(?:\/(\d{1,5}))?:(.+)$/.exec(text);
  // "servidor:5432" é endereço e porta, não Firebird.
  if (!match?.[1] || !match[3] || /^\d+$/.test(match[3])) return null;
  return {
    engine: 'firebird',
    host: match[1],
    ...(match[2] ? { port: Number(match[2]) } : {}),
    database: match[3],
    warnings: [],
  };
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

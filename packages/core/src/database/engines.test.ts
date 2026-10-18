import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbSession } from './common';
import { connectDatabase } from './connect';
import { previewSql, quoteIdentifier, readOnlyViolation } from './sql';
import type { DbConnectionConfig, DbEngine } from './types';

describe('trava de somente leitura (Postgres, MySQL, SQL Server)', () => {
  it('aceita consultas', () => {
    for (const sql of [
      'SELECT * FROM clientes',
      '  -- comentário\n select 1',
      'WITH x AS (SELECT 1 AS a) SELECT * FROM x',
      'SHOW TABLES',
      'EXPLAIN SELECT 1',
      "SELECT 'DELETE FROM x; DROP TABLE y' AS texto",
      'SELECT [Delete] FROM t',
      "SELECT 'C:\\pasta' AS caminho, 'it''s' AS t FROM t -- delete",
      'SELECT * FROM t /* drop */ WHERE a = 1',
    ])
      expect(readOnlyViolation(sql), sql).toBeNull();
  });

  it('recusa escrita, execução e truques comuns', () => {
    for (const sql of [
      "UPDATE clientes SET nome = 'x'",
      'DELETE FROM clientes',
      'SELECT * INTO copia FROM clientes',
      'SELECT 1; DROP TABLE clientes',
      'SELECT 1 DELETE FROM clientes',
      'WITH d AS (DELETE FROM pedidos RETURNING *) SELECT * FROM d',
      "SELECT nextval('pedidos_id_seq')",
      'EXEC sp_who',
      "SELECT * FROM OPENROWSET('x', 'y', 'z')",
      'SELECT * FROM clientes INTO OUTFILE "/tmp/x"',
      // Comentário dentro de texto não pode esconder o resto do comando.
      "SELECT '--'; DELETE FROM clientes",
      "SELECT '/*'; DROP TABLE clientes; SELECT '*/'",
      "SELECT '--' AS x; CREATE TABLE copia (a int); COMMIT",
      // Regras do MySQL: \' dentro de texto, # como comentário, --sem espaço e /*! */.
      "SELECT 'a\\'' , 1 INTO OUTFILE '/tmp/x' -- '",
      "SELECT 1 # '\n INTO OUTFILE '/tmp/x'",
      "SELECT 1--1 INTO OUTFILE '/tmp/x'",
      "SELECT 1 /*!50000 INTO OUTFILE '/tmp/x' */",
    ])
      expect(readOnlyViolation(sql), sql).not.toBeNull();
  });
});

describe('nomes e prévias por motor', () => {
  it('coloca aspas só quando precisa', () => {
    expect(quoteIdentifier('postgres', 'clientes')).toBe('clientes');
    expect(quoteIdentifier('postgres', 'Notas Fiscais')).toBe('"Notas Fiscais"');
    expect(quoteIdentifier('postgres', 'order')).toBe('"order"');
    expect(quoteIdentifier('mysql', 'order')).toBe('`order`');
    expect(quoteIdentifier('sqlserver', 'Notas Fiscais')).toBe('[Notas Fiscais]');
    expect(quoteIdentifier('firebird', 'CLIENTES')).toBe('CLIENTES');
    expect(quoteIdentifier('firebird', 'Clientes')).toBe('"Clientes"');
  });

  it('monta a prévia na sintaxe de cada banco', () => {
    expect(previewSql('firebird', 'T')).toBe('SELECT FIRST 100 * FROM T');
    expect(previewSql('postgres', 'T', 10)).toBe('SELECT * FROM T LIMIT 10');
    expect(previewSql('mysql', 'T')).toBe('SELECT * FROM T LIMIT 100');
    expect(previewSql('sqlserver', 'T')).toBe('SELECT TOP 100 * FROM T');
  });
});

/**
 * Integração com bancos de verdade (Docker):
 *   node packages/core/scripts/databases/setup.mjs
 *   ROTA_PG_TEST=127.0.0.1:5433 ROTA_MYSQL_TEST=127.0.0.1:3307 ROTA_MSSQL_TEST=127.0.0.1:14330 \
 *     pnpm --filter @rota/core test
 */
const PASSWORD = 'Rota_teste_123';

interface EngineCase {
  engine: DbEngine;
  env: string | undefined;
  user: string;
  database: string;
  /** Nomes das colunas/tabelas como o motor guarda. */
  n: (lower: string) => string;
  versionPattern: RegExp;
  extraTable: string;
}

const pascal = (name: string) =>
  name
    .split('_')
    .map((part) => (part === 'id' ? 'Id' : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');

const cases: EngineCase[] = [
  {
    engine: 'postgres',
    env: process.env.ROTA_PG_TEST,
    user: 'postgres',
    database: 'loja',
    n: (s) => s,
    versionPattern: /^PostgreSQL 16/,
    extraTable: 'vendas.Notas Fiscais',
  },
  {
    engine: 'mysql',
    env: process.env.ROTA_MYSQL_TEST,
    user: 'root',
    database: 'loja',
    n: (s) => s,
    versionPattern: /^MySQL 8/,
    extraTable: 'order',
  },
  {
    engine: 'sqlserver',
    env: process.env.ROTA_MSSQL_TEST,
    user: 'sa',
    database: 'Loja',
    n: (s) => (s === 'data_cadastro' ? 'DataCadastro' : s === 'atualizado_em' ? 'AtualizadoEm' : pascal(s)),
    versionPattern: /^SQL Server 16/,
    extraTable: 'vendas.Notas Fiscais',
  },
];

for (const c of cases) {
  const [host = '', port = '0'] = (c.env ?? '').split(':');
  const config = (patch: Partial<DbConnectionConfig> = {}): DbConnectionConfig => ({
    id: c.engine,
    name: c.engine,
    engine: c.engine,
    host,
    port: Number(port),
    database: c.database,
    user: c.user,
    credentialId: null,
    charset: 'auto',
    ssl: false,
    environment: 'teste',
    readOnly: true,
    ...patch,
  });
  const t = c.n;

  describe.skipIf(!c.env)(`${c.engine} (integração)`, () => {
    let db: DbSession;
    beforeAll(async () => {
      db = await connectDatabase(config(), PASSWORD);
    });
    afterAll(() => db?.close());

    it('conecta e informa a versão', () => {
      expect(db.info.version).toMatch(c.versionPattern);
    });

    it('lê acentos, números exatos e datas sem mudar o fuso', async () => {
      const sql = `SELECT ${t('nome')}, ${t('cidade')}, ${t('saldo')}, ${t('pontos')}, ${t('data_cadastro')}, ${t(
        'atualizado_em',
      )} FROM ${t('clientes')} ORDER BY ${t('id')}`;
      const result = await db.run(sql, { readOnly: true });
      expect(result.rows[0]).toEqual([
        'João da Conceição',
        'São Paulo',
        1520.75,
        '9007199254740993',
        '2024-03-15',
        '2024-03-15 14:32:10',
      ]);
      expect(result.rows[1]?.[2]).toBe(-35.1);
      expect(result.rows[1]?.[3]).toBe(42);
      expect(result.rows[2]?.[0]).toBe('Ágatha Ümit Çelik');
    });

    it('lê a estrutura: tabelas, views, PK, FK e nomes com aspas', async () => {
      const schema = await db.schema();
      const names = schema.tables.map((x) => x.name);
      expect(names).toEqual(expect.arrayContaining([t('clientes'), t('pedidos'), c.extraTable]));
      expect(
        schema.tables.find((x) => x.name === (c.engine === 'sqlserver' ? 'VwPedidos' : 'vw_pedidos'))?.kind,
      ).toBe('view');
      const clientes = schema.tables.find((x) => x.name === t('clientes'));
      expect(clientes?.columns.find((col) => col.name === t('id'))?.primaryKey).toBe(true);
      expect(clientes?.columns.find((col) => col.name === t('nome'))?.nullable).toBe(false);
      const pedidos = schema.tables.find((x) => x.name === t('pedidos'));
      expect(pedidos?.columns.find((col) => col.name === t('cliente_id'))?.references).toBe(
        `${t('clientes')}.${t('id')}`,
      );
      const extra = schema.tables.find((x) => x.name === c.extraTable);
      const preview = await db.run(previewSql(c.engine, extra?.ref ?? '', 5), { readOnly: true });
      expect(preview.columns.length).toBeGreaterThan(0);
    });

    it('respeita o limite de linhas', async () => {
      const result = await db.run(`SELECT ${t('id')} FROM ${t('pedidos')} ORDER BY ${t('id')}`, {
        readOnly: true,
        limit: 2,
      });
      expect(result.rows).toEqual([[1], [2]]);
      expect(result.truncated).toBe(true);
    });

    it('somente leitura: recusa escrita e o banco fica intacto', async () => {
      await expect(
        db.run(`UPDATE ${t('pedidos')} SET ${t('status')} = 'x'`, { readOnly: true }),
      ).rejects.toThrow(/somente leitura/);
      const result = await db.run(`SELECT ${t('status')} FROM ${t('pedidos')} ORDER BY ${t('id')}`, {
        readOnly: true,
      });
      expect(result.rows.flat()).toEqual(['pago', 'cancelado', 'aguardando']);
    });

    it('com escrita liberada, executa e informa as linhas afetadas', async () => {
      const result = await db.run(
        `UPDATE ${t('pedidos')} SET ${t('status')} = ${t('status')} WHERE ${t('status')} = 'pago'`,
        { readOnly: false },
      );
      expect(result.affected).toBe(1);
    });

    it('cancela uma consulta longa e a sessão continua utilizável', async () => {
      const slow =
        c.engine === 'postgres'
          ? 'SELECT pg_sleep(10)'
          : c.engine === 'mysql'
            ? 'SELECT SLEEP(10)'
            : "SELECT 1 AS x; WAITFOR DELAY '00:00:10'";
      const started = Date.now();
      const running = db.run(slow, { readOnly: c.engine !== 'sqlserver' });
      setTimeout(() => void db.cancel(), 400);
      await running.catch(() => undefined);
      expect(Date.now() - started).toBeLessThan(5000);
      expect((await db.run('SELECT 1', { readOnly: true })).rows).toEqual([[1]]);
    });

    it('explica os erros de conexão em português', async () => {
      const fail = (patch: Partial<DbConnectionConfig>, password = PASSWORD) =>
        connectDatabase(config(patch), password).then(
          (s) => s.close().then(() => 'conectou'),
          (e: Error) => e.message,
        );
      expect(await fail({}, 'errada')).toMatch(/senha inválidos/);
      expect(await fail({ database: 'nao_existe' })).toMatch(/não existe/);
      expect(await fail({ port: 3999 })).toMatch(/Nada respondeu em/);
    });
  });
}

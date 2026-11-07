import { describe, expect, it } from 'vitest';
import { connectDatabase } from './connect';
import { splitSqlStatements } from './sql';
import type { DbConnectionConfig, DbEngine } from './types';

/**
 * Vários comandos com comentários, separados pelo Rota e executados um por
 * um em cada banco de verdade (como o "Executar tudo" do editor). Para rodar,
 * suba os containers (scripts/firebird e scripts/databases) e defina
 * ROTA_FIREBIRD_TEST, ROTA_PG_TEST, ROTA_MYSQL_TEST e ROTA_MSSQL_TEST.
 */

interface Case {
  engine: DbEngine;
  env: string | undefined;
  user: string;
  database: string;
  password: string;
  /** Comentário extra que só esse banco entende. */
  extraComment: string;
  /** Bloco com ";" dentro, que precisa ir inteiro (só com escrita liberada). */
  block: string;
  /** Separador de lote próprio (GO, SET TERM...), quando existe. */
  script?: (statements: string[]) => string;
}

const cases: Case[] = [
  {
    engine: 'firebird',
    env: process.env.ROTA_FIREBIRD_TEST,
    user: 'SYSDBA',
    database: 'LOJA_WIN',
    password: 'masterkey', // senha do container de teste
    extraComment: '/* firebird */',
    block: 'EXECUTE BLOCK RETURNS (C9 INTEGER) AS\nBEGIN\n  C9 = 9;\n  SUSPEND;\nEND',
  },
  {
    engine: 'postgres',
    env: process.env.ROTA_PG_TEST,
    user: 'postgres',
    database: 'loja',
    password: 'Rota_teste_123', // senha do container de teste
    extraComment: '/* postgres */',
    block: "DO $$ BEGIN PERFORM 1; PERFORM 'a;b'; END $$",
  },
  {
    engine: 'mysql',
    env: process.env.ROTA_MYSQL_TEST,
    user: 'root',
    database: 'loja',
    password: 'Rota_teste_123', // senha do container de teste
    extraComment: '# mysql; com ponto e vírgula',
    block: "SELECT 'it\\'s; ok' AS c9",
  },
  {
    engine: 'sqlserver',
    env: process.env.ROTA_MSSQL_TEST,
    user: 'sa',
    database: 'Loja',
    password: 'Rota_teste_123', // senha do container de teste
    extraComment: '/* sql server */',
    block: 'IF 1 = 1\nBEGIN\n  SELECT 9 AS c9;\nEND',
    script: (statements) => statements.join('\nGO\n'),
  },
];

for (const c of cases) {
  describe.skipIf(!c.env)(`${c.engine}: comandos em sequência (integração)`, () => {
    const [host = '', port = '0'] = (c.env ?? '').split(':');
    const config = (readOnly: boolean): DbConnectionConfig => ({
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
      readOnly,
    });
    const from = c.engine === 'firebird' ? ' FROM RDB$DATABASE' : '';

    it('separa e executa cada comando, com comentários em toda parte', async () => {
      const script = [
        '-- cabeçalho; com ponto e vírgula',
        `SELECT 1 AS c1${from}; -- fim da linha`,
        '/* bloco; */',
        c.extraComment,
        `SELECT 'a;b' AS c2${from};`,
        `-- SELECT 999${from};`,
        `SELECT 3 AS c3${from} /* ; */;`,
        '-- comentário final',
      ].join('\n');
      const statements = splitSqlStatements(script, c.engine).map((s) => s.text);
      expect(statements).toHaveLength(3);
      const db = await connectDatabase(config(true), c.password);
      try {
        const values = [];
        for (const sql of statements) values.push((await db.run(sql, { readOnly: true, limit: 10 })).rows);
        expect(values).toEqual([[[1]], [['a;b']], [[3]]]);
      } finally {
        await db.close();
      }
    }, 60_000);

    it('manda inteiro um bloco com ";" dentro', async () => {
      const text = c.script
        ? c.script([c.block, `SELECT 1 AS c1${from}`])
        : `${c.block};\nSELECT 1 AS c1${from};`;
      const statements = splitSqlStatements(text, c.engine).map((s) => s.text);
      expect(statements).toEqual([c.block, `SELECT 1 AS c1${from}`]);
      const db = await connectDatabase(config(false), c.password);
      try {
        for (const sql of statements) await db.run(sql, { readOnly: false, limit: 10 });
      } finally {
        await db.close();
      }
    }, 60_000);
  });
}

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbSession } from './common';
import { connectDatabase } from './connect';
import {
  type ColumnProfile,
  columnNote,
  PROFILE_SAMPLE,
  parseAggregateRow,
  profileAggregateSql,
  profileKind,
  profileSource,
  profileTable,
  profileToMarkdown,
  profileTopSql,
} from './profile';
import type { DbColumn, DbConnectionConfig, DbEngine, DbQueryResult, DbTable } from './types';

const col = (name: string, type: string, extra: Partial<DbColumn> = {}): DbColumn => ({
  name,
  type,
  nullable: true,
  primaryKey: false,
  ...extra,
});

const clientes: DbTable = {
  name: 'CLIENTES',
  ref: 'CLIENTES',
  kind: 'table',
  columns: [
    col('ID', 'INTEGER', { primaryKey: true }),
    col('OBS', 'BLOB SUB_TYPE TEXT'),
    col('ATIVO', 'BOOLEAN'),
  ],
};

describe('perfil: SQL por banco', () => {
  it('classifica os tipos', () => {
    expect(profileKind('firebird', 'BLOB SUB_TYPE TEXT')).toBe('large');
    expect(profileKind('postgres', 'jsonb')).toBe('large');
    expect(profileKind('postgres', 'uuid')).toBe('unordered');
    expect(profileKind('sqlserver', 'bit')).toBe('unordered');
    expect(profileKind('sqlserver', 'ntext')).toBe('large');
    expect(profileKind('mysql', 'varchar(60)')).toBe('normal');
  });

  it('usa a tabela inteira ou uma amostra na sintaxe do banco', () => {
    expect(profileSource('firebird', clientes, 10)).toBe('CLIENTES p');
    const many = PROFILE_SAMPLE + 1;
    expect(profileSource('firebird', clientes, many)).toBe(
      `(SELECT FIRST ${PROFILE_SAMPLE} * FROM CLIENTES) p`,
    );
    expect(profileSource('sqlserver', clientes, many)).toBe(
      `(SELECT TOP ${PROFILE_SAMPLE} * FROM CLIENTES) p`,
    );
    expect(profileSource('postgres', clientes, many)).toBe(
      `(SELECT * FROM CLIENTES LIMIT ${PROFILE_SAMPLE}) p`,
    );
  });

  it('agrega só o que cada tipo permite', () => {
    expect(profileAggregateSql('firebird', clientes.columns, 'CLIENTES p')).toBe(
      'SELECT COUNT(p.ID) AS F0, COUNT(DISTINCT p.ID) AS D0, MIN(p.ID) AS MN0, MAX(p.ID) AS MX0, ' +
        'COUNT(p.OBS) AS F1, COUNT(p.ATIVO) AS F2, COUNT(DISTINCT p.ATIVO) AS D2 FROM CLIENTES p',
    );
  });

  it('lê a linha de agregados na mesma ordem', () => {
    const [id, obs, ativo] = parseAggregateRow('firebird', clientes.columns, ['3', 3, 1, 3, 2, 3, 2]);
    expect(id).toMatchObject({ filled: 3, distinct: 3, min: 1, max: 3, primaryKey: true });
    expect(obs).toMatchObject({ filled: 2, distinct: null, min: null, kind: 'large' });
    expect(ativo).toMatchObject({ filled: 3, distinct: 2, min: null, kind: 'unordered' });
  });

  it('mais comuns com o limite de cada banco', () => {
    const c = col('CIDADE', 'VARCHAR(40)');
    expect(profileTopSql('firebird', c, 'CLIENTES p')).toBe(
      'SELECT FIRST 5 p.CIDADE AS VALOR, COUNT(*) AS QTD FROM CLIENTES p WHERE p.CIDADE IS NOT NULL GROUP BY p.CIDADE ORDER BY 2 DESC',
    );
    expect(profileTopSql('sqlserver', c, 'T p', 3)).toMatch(/^SELECT TOP 3 /);
    expect(profileTopSql('mysql', c, 'T p')).toMatch(/ORDER BY 2 DESC LIMIT 5$/);
  });

  it('notas e Markdown', () => {
    const base: ColumnProfile = {
      name: 'ID',
      type: 'INTEGER',
      kind: 'normal',
      primaryKey: true,
      filled: 3,
      distinct: 3,
      min: 1,
      max: 3,
      top: [],
    };
    expect(columnNote(base, 3)).toBe('sem repetidos');
    expect(columnNote({ ...base, filled: 0, distinct: 0 }, 3)).toBe('sempre vazia');
    expect(columnNote({ ...base, distinct: 1 }, 3)).toBe('um valor só');
    const md = profileToMarkdown({
      table: 'CLIENTES',
      total: 3,
      analyzed: 3,
      sampled: false,
      columns: [
        base,
        {
          ...base,
          name: 'CIDADE',
          primaryKey: false,
          filled: 2,
          distinct: 1,
          top: [{ value: 'Goiânia', count: 2 }],
        },
      ],
    });
    expect(md).toContain('## Perfil de `CLIENTES` (3 linhas)');
    expect(md).toContain('| ID (PK) | INTEGER | 100% | 3 (sem repetidos) | 1 | 3 |  |');
    expect(md).toContain('| CIDADE | INTEGER | 66,7% | 1 (um valor só) | 1 | 3 | Goiânia (2) |');
  });

  it('cai para coluna a coluna quando um lote falha', async () => {
    const calls: string[] = [];
    const ok = (rows: DbQueryResult['rows']): DbQueryResult => ({
      columns: [],
      rows,
      truncated: false,
      durationMs: 0,
    });
    const run = async (sql: string) => {
      calls.push(sql);
      if (sql.startsWith('SELECT COUNT(*)')) return ok([[2]]);
      if (sql.includes('p.ID') && sql.includes('p.OBS')) throw new Error('tipo não suportado');
      if (sql.includes('MIN(p.ID)')) return ok([[2, 2, 1, 2]]);
      if (sql.includes('COUNT(DISTINCT p.ATIVO)')) throw new Error('não agrupa');
      return ok([[1]]);
    };
    const profile = await profileTable(run, 'firebird', clientes);
    expect(profile.columns.map((c) => [c.name, c.filled, c.distinct])).toEqual([
      ['ID', 2, 2],
      ['OBS', 1, null],
      ['ATIVO', 1, null],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Integração (bancos de teste no Docker; pulados sem as variáveis)

const PASSWORD = 'Rota_teste_123';
const integration: {
  engine: DbEngine;
  env: string | undefined;
  user: string;
  database: string;
  password: string;
  table: string;
}[] = [
  {
    engine: 'postgres',
    env: process.env.ROTA_PG_TEST,
    user: 'postgres',
    database: 'loja',
    password: PASSWORD,
    table: 'clientes',
  },
  {
    engine: 'mysql',
    env: process.env.ROTA_MYSQL_TEST,
    user: 'root',
    database: 'loja',
    password: PASSWORD,
    table: 'clientes',
  },
  {
    engine: 'sqlserver',
    env: process.env.ROTA_MSSQL_TEST,
    user: 'sa',
    database: 'Loja',
    password: PASSWORD,
    table: 'clientes',
  },
  {
    engine: 'firebird',
    env: process.env.ROTA_FIREBIRD_TEST,
    user: 'SYSDBA',
    database: 'LOJA_WIN',
    password: 'masterkey',
    table: 'CLIENTES',
  },
];

for (const c of integration) {
  describe.skipIf(!c.env)(`perfil no ${c.engine} (integração)`, () => {
    const [host = '', port = '0'] = (c.env ?? '').split(':');
    const config: DbConnectionConfig = {
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
    };
    let db: DbSession;
    beforeAll(async () => {
      db = await connectDatabase(config, c.password);
    });
    afterAll(() => db?.close());

    it('analisa todas as colunas da tabela de clientes', async () => {
      const schema = await db.schema();
      const table = schema.tables.find((t) => t.name.toLowerCase() === c.table.toLowerCase());
      expect(table).toBeDefined();
      if (!table) return;
      const profile = await profileTable(
        (sql, limit) => db.run(sql, { readOnly: true, limit }),
        c.engine,
        table,
      );
      expect(profile.total).toBeGreaterThan(0);
      expect(profile.columns).toHaveLength(table.columns.length);
      const id = profile.columns.find((x) => x.name.toLowerCase() === 'id');
      expect(id?.distinct).toBe(profile.total);
      expect(profile.columns.every((x) => x.filled <= profile.total)).toBe(true);
      // Nenhuma coluna comum caiu no modo reduzido (só contagem) por erro de SQL.
      const reduced = profile.columns.filter(
        (x) => x.distinct === null && profileKind(c.engine, x.type) !== 'large',
      );
      expect(reduced.map((x) => x.name)).toEqual([]);
    });
  });
}

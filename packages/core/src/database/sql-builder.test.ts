// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${1:nome} é a sintaxe dos snippets do Monaco, não interpolação.
import { describe, expect, it } from 'vitest';
import { buildSqlCommand, conditionsForRow, editableTableFor, literalFor } from './sql-builder';
import { snippetText, sqlExamples } from './sql-examples';
import type { DbTable } from './types';

const clientes: DbTable = {
  name: 'CLIENTES',
  ref: 'CLIENTES',
  kind: 'table',
  columns: [
    { name: 'ID', type: 'INTEGER', nullable: false, primaryKey: true },
    { name: 'NOME', type: 'VARCHAR(60)', nullable: false, primaryKey: false },
    { name: 'SALDO', type: 'NUMERIC(15,2)', nullable: true, primaryKey: false },
    { name: 'ATIVO', type: 'boolean', nullable: true, primaryKey: false },
    { name: 'OBS', type: 'BLOB SUB_TYPE TEXT', nullable: true, primaryKey: false },
  ],
};

const auto = (text: string) => ({ mode: 'auto' as const, text });

describe('literalFor', () => {
  it('converte pelo tipo da coluna', () => {
    const [id, nome, saldo, ativo] = clientes.columns;
    expect(literalFor('firebird', saldo, auto('12,50')).sql).toBe('12.50');
    expect(literalFor('firebird', saldo, auto('1.234,50')).sql).toBe('1234.50');
    expect(literalFor('firebird', saldo, auto('1.5')).sql).toBe('1.5');
    expect(literalFor('firebird', saldo, auto('1.234')).sql).toBe('1.234');
    expect(literalFor('firebird', id, auto('abc')).problem).toMatch(/numérica/);
    expect(literalFor('firebird', nome, auto("D'Ávila")).sql).toBe("'D''Ávila'");
    expect(literalFor('sqlserver', nome, auto('João')).sql).toBe("N'João'");
    expect(literalFor('postgres', ativo, auto('sim')).sql).toBe('TRUE');
    expect(literalFor('mysql', ativo, auto('false')).sql).toBe('0');
    expect(literalFor('firebird', nome, { mode: 'null', text: 'x' }).sql).toBe('NULL');
    expect(literalFor('firebird', id, { mode: 'sql', text: 'GEN_ID(GEN_CLIENTES, 1)' }).sql).toBe(
      'GEN_ID(GEN_CLIENTES, 1)',
    );
  });
});

describe('buildSqlCommand', () => {
  it('SELECT com filtro, ordem e limite na sintaxe de cada banco', () => {
    const spec = {
      kind: 'select' as const,
      table: clientes,
      columns: ['ID', 'NOME'],
      where: [{ column: 'NOME', operator: 'contains' as const, value: 'silva' }],
      orderBy: { column: 'NOME', desc: false },
      limit: 20,
    };
    expect(buildSqlCommand('firebird', spec).sql).toBe(
      "SELECT FIRST 20 ID, NOME\nFROM CLIENTES\nWHERE NOME CONTAINING 'silva'\nORDER BY NOME;",
    );
    expect(buildSqlCommand('postgres', spec).sql).toBe(
      'SELECT "ID", "NOME"\nFROM CLIENTES\nWHERE "NOME" ILIKE \'%silva%\'\nORDER BY "NOME"\nLIMIT 20;',
    );
    expect(buildSqlCommand('sqlserver', spec).sql).toMatch(/^SELECT TOP 20 ID, NOME/);
    expect(buildSqlCommand('firebird', spec).explanation).toBe(
      'Busca 2 colunas de CLIENTES onde NOME contém "silva", em ordem crescente de NOME, até 20 linhas.',
    );
  });

  it('INSERT avisa colunas obrigatórias e lembra do generator no Firebird', () => {
    const built = buildSqlCommand('firebird', {
      kind: 'insert',
      table: clientes,
      values: [{ column: 'SALDO', value: auto('10') }],
    });
    expect(built.sql).toBe('INSERT INTO CLIENTES (SALDO)\nVALUES (10);');
    expect(built.warnings[0]).toMatch(/ID, NOME/);
    expect(built.warnings[1]).toMatch(/GEN_ID/);
    expect(built.problems).toEqual([]);
  });

  it('UPDATE com SELECT de conferência e erro de tipo', () => {
    const built = buildSqlCommand('firebird', {
      kind: 'update',
      table: clientes,
      values: [
        { column: 'NOME', value: auto('Loja Exemplo') },
        { column: 'SALDO', value: { mode: 'null', text: '' } },
      ],
      where: [{ column: 'ID', operator: 'eq', value: '15' }],
      withCheck: true,
    });
    expect(built.sql).toBe(
      [
        '-- 1) Confira antes as linhas atingidas (Ctrl+Enter com o cursor aqui):',
        'SELECT * FROM CLIENTES',
        'WHERE ID = 15;',
        '',
        '-- 2) Depois rode o comando:',
        'UPDATE CLIENTES',
        "SET NOME = 'Loja Exemplo',",
        '    SALDO = NULL',
        'WHERE ID = 15;',
      ].join('\n'),
    );
    expect(built.affectsAll).toBe(false);
    expect(built.explanation).toBe('Altera NOME, SALDO em CLIENTES nas linhas em que ID = 15.');

    const wrong = buildSqlCommand('firebird', {
      kind: 'update',
      table: clientes,
      values: [{ column: 'SALDO', value: auto('muito') }],
      where: [{ column: 'ID', operator: 'eq', value: 'x' }],
    });
    expect(wrong.problems).toHaveLength(2);
  });

  it('DELETE sem WHERE avisa que pega a tabela inteira', () => {
    const built = buildSqlCommand('firebird', {
      kind: 'delete',
      table: clientes,
      where: [],
      withCheck: true,
    });
    expect(built.sql).toBe('DELETE FROM CLIENTES;');
    expect(built.affectsAll).toBe(true);
    expect(built.warnings[0]).toMatch(/TODAS/);
  });
});

describe('linhas do resultado', () => {
  it('identifica pela chave primária quando ela veio na consulta', () => {
    const { conditions, byPrimaryKey } = conditionsForRow(clientes, ['id', 'nome'], [7, 'Ana']);
    expect(byPrimaryKey).toBe(true);
    expect(conditions).toEqual([{ column: 'ID', operator: 'eq', value: '7' }]);
  });

  it('sem a chave, usa as colunas comparáveis (NULL vira IS NULL)', () => {
    const { conditions, byPrimaryKey } = conditionsForRow(
      clientes,
      ['NOME', 'SALDO', 'OBS'],
      ['Ana', null, 'texto longo'],
    );
    expect(byPrimaryKey).toBe(false);
    expect(conditions).toEqual([
      { column: 'NOME', operator: 'eq', value: 'Ana' },
      { column: 'SALDO', operator: 'isnull', value: '' },
    ]);
  });

  it('só oferece edição para SELECT de uma tabela', () => {
    const quoted: DbTable = { ...clientes, name: 'vendas.Notas Fiscais', ref: 'vendas."Notas Fiscais"' };
    const tables = [clientes, quoted];
    expect(editableTableFor('SELECT FIRST 100 * FROM CLIENTES', tables)).toBe(clientes);
    expect(editableTableFor("select * from clientes where nome = 'a JOIN b'", tables)).toBe(clientes);
    expect(editableTableFor('SELECT * FROM vendas."Notas Fiscais"', tables)).toBe(quoted);
    expect(
      editableTableFor('SELECT * FROM CLIENTES c JOIN PEDIDOS p ON p.ID = c.ID', tables),
    ).toBeUndefined();
    expect(editableTableFor('SELECT NOME, COUNT(*) FROM CLIENTES GROUP BY NOME', tables)).toBeUndefined();
  });
});

describe('exemplos de SQL', () => {
  it('cada banco tem exemplos e o texto puro não deixa marcas de snippet', () => {
    for (const engine of ['firebird', 'postgres', 'mysql', 'sqlserver'] as const) {
      const items = sqlExamples(engine).flatMap((g) => g.items);
      expect(items.length).toBeGreaterThan(15);
      for (const item of items) expect(snippetText(item.snippet)).not.toMatch(/\$\{|\$\d/);
    }
    expect(snippetText("UPDATE ${1:tabela} SET ${2:c} = ${3:'x'} ORDER BY ${4|DESC,ASC|}$0")).toBe(
      "UPDATE tabela SET c = 'x' ORDER BY DESC",
    );
    expect(snippetText(sqlExamples('firebird')[0]?.items[0]?.snippet ?? '')).toBe(
      'SELECT FIRST 10 *\nFROM tabela;',
    );
  });
});

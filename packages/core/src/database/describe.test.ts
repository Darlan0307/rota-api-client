import { describe, expect, it } from 'vitest';
import { resultToMarkdown, tablesToMarkdown, tableToMarkdown } from './describe';
import type { DbTable } from './types';

const clientes: DbTable = {
  name: 'CLIENTES',
  ref: 'CLIENTES',
  kind: 'table',
  columns: [
    { name: 'ID', type: 'INTEGER', nullable: false, primaryKey: true },
    { name: 'NOME', type: 'VARCHAR(60)', nullable: false, primaryKey: false },
    {
      name: 'CIDADE_ID',
      type: 'INTEGER',
      nullable: true,
      primaryKey: false,
      references: 'CIDADES.ID',
    },
    { name: 'ATIVO', type: 'CHAR(1)', nullable: true, primaryKey: false, defaultValue: "'S'" },
  ],
};

describe('estrutura em Markdown', () => {
  it('lista colunas, tipos, nulos e chaves', () => {
    const md = tableToMarkdown(clientes);
    expect(md).toContain('## Tabela `CLIENTES`');
    expect(md).toContain('| ID | INTEGER | não | PK |  |');
    expect(md).toContain('| CIDADE_ID | INTEGER | sim | FK → CIDADES.ID |  |');
    expect(md).toContain("| ATIVO | CHAR(1) | sim |  | 'S' |");
  });

  it('inclui a amostra e avisa quando a tabela está vazia', () => {
    const sample = {
      columns: [
        { name: 'ID', type: 'INTEGER' },
        { name: 'NOME', type: 'VARCHAR' },
      ],
      rows: [[1, 'João da Conceição']],
      truncated: false,
      durationMs: 1,
    };
    expect(tableToMarkdown(clientes, { sample })).toContain(
      'Amostra (1 linha):\n\n| ID | NOME |\n| --- | --- |\n| 1 | João da Conceição |',
    );
    expect(tableToMarkdown(clientes, { sample: { ...sample, rows: [] } })).toContain(
      'Amostra: a tabela está vazia.',
    );
  });

  it('escapa barras verticais, quebra linhas e corta textos longos', () => {
    const md = resultToMarkdown(['OBS'], [['a|b\nc'], ['x'.repeat(100)], [null]]);
    expect(md).toContain('| a\\|b c |');
    expect(md).toContain(`| ${'x'.repeat(80)}… |`);
    expect(md.split('\n').at(-1)).toBe('|  |');
  });

  it('junta várias tabelas com o tipo do banco', () => {
    const md = tablesToMarkdown('firebird', [clientes, { ...clientes, name: 'V_CLIENTES', kind: 'view' }]);
    expect(md.startsWith('Banco Firebird (2 tabelas).')).toBe(true);
    expect(md).toContain('## View `V_CLIENTES`');
  });
});

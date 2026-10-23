import { describe, expect, it } from 'vitest';
import type { DbTable } from '../database/types';
import { generateTypes, pascalCase, singular, sqlTypeToTs, tableToTypeScript } from './types';

const pedido = {
  id: 10,
  numero: 'A-1',
  pago: true,
  observacao: null,
  cliente: { nome: 'João da Conceição', 'e-mail': 'joao@exemplo.com' },
  itens: [
    { produto: 'Caneta', quantidade: 2 },
    { produto: 'Caderno', quantidade: 1, desconto: 0.5 },
  ],
  tags: [],
};

describe('nomes', () => {
  it('PascalCase sem acento', () => {
    expect(pascalCase('data_nascimento')).toBe('DataNascimento');
    expect(pascalCase('endereçoEntrega')).toBe('EnderecoEntrega');
    expect(pascalCase('123abc')).toBe('T123abc');
  });

  it('singular aproximado', () => {
    expect(singular('itens')).toBe('item');
    expect(singular('pedidos')).toBe('pedido');
    expect(singular('PEDIDOS')).toBe('PEDIDO');
    expect(pascalCase(singular('opções'))).toBe('Opcao');
    expect(singular('status')).toBe('status');
  });
});

describe('tipos a partir de JSON', () => {
  it('TypeScript com interfaces aninhadas e campos opcionais', () => {
    const ts = generateTypes(pedido, 'typescript', 'pedido');
    expect(ts).toContain('export interface Pedido {');
    expect(ts).toContain('  observacao: null;');
    expect(ts).toContain('  cliente: Cliente;');
    expect(ts).toContain('  "e-mail": string;');
    expect(ts).toContain('  itens: Item[];');
    expect(ts).toContain('  desconto?: number;');
    expect(ts).toContain('  tags: unknown[];');
    // A raiz vem primeiro.
    expect(ts.indexOf('interface Pedido')).toBeLessThan(ts.indexOf('interface Cliente'));
  });

  it('TypeScript para lista na raiz', () => {
    const ts = generateTypes([{ id: 1 }], 'typescript', 'Pedidos');
    expect(ts).toContain('export type Pedidos = Pedido[];');
    expect(ts).toContain('export interface Pedido {');
  });

  it('Zod com nullable, optional e union', () => {
    const zod = generateTypes({ a: null, b: [1, 'x'], c: [{ d: 1 }, {}] }, 'zod', 'resposta');
    expect(zod).toContain('export const RespostaSchema = z.object({');
    expect(zod).toContain('a: z.null(),');
    expect(zod).toContain('b: z.array(z.union([z.number(), z.string()])),');
    expect(zod).toContain('d: z.number().optional(),');
    expect(zod).toContain('export type Resposta = z.infer<typeof RespostaSchema>;');
  });

  it('JSON Schema com required', () => {
    const schema = JSON.parse(generateTypes(pedido, 'jsonschema', 'pedido'));
    expect(schema.title).toBe('Pedido');
    expect(schema.required).toContain('itens');
    expect(schema.properties.itens.items.required).toEqual(['produto', 'quantidade']);
    expect(schema.properties.observacao.type).toBe('null');
  });
});

describe('tipos a partir de tabela', () => {
  it('mapeia tipos SQL comuns', () => {
    expect(sqlTypeToTs('VARCHAR(60)')).toBe('string');
    expect(sqlTypeToTs('character varying(60)')).toBe('string');
    expect(sqlTypeToTs('NUMERIC(15,2)')).toBe('number');
    expect(sqlTypeToTs('tinyint(1)')).toBe('boolean');
    expect(sqlTypeToTs('bit')).toBe('boolean');
    expect(sqlTypeToTs('TIMESTAMP')).toBe('string');
    expect(sqlTypeToTs('BLOB SUB_TYPE TEXT')).toBe('string');
    expect(sqlTypeToTs('BLOB SUB_TYPE 0')).toBe('Uint8Array');
    expect(sqlTypeToTs('jsonb')).toBe('unknown');
    expect(sqlTypeToTs('uniqueidentifier')).toBe('string');
  });

  it('gera a interface com nulos e comentários', () => {
    const table: DbTable = {
      name: 'CLIENTES',
      ref: 'CLIENTES',
      kind: 'table',
      columns: [
        { name: 'ID', type: 'INTEGER', nullable: false, primaryKey: true },
        { name: 'CIDADE_ID', type: 'INTEGER', nullable: true, primaryKey: false, references: 'CIDADES.ID' },
      ],
    };
    const ts = tableToTypeScript(table);
    expect(ts).toContain('export interface Cliente {');
    expect(ts).toContain('  /** INTEGER · PK */\n  ID: number;');
    expect(ts).toContain('  CIDADE_ID: number | null;');
  });
});

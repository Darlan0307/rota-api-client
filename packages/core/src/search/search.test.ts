import { describe, expect, it } from 'vitest';
import { RequestDataSchema } from '../model/schemas';
import type { WorkspaceSnapshot } from '../model/tree';
import { searchWorkspace } from './search';

const req = (id: string, name: string, data: unknown, parentId = 'c1') => ({
  kind: 'request' as const,
  id,
  name,
  parentId,
  data: RequestDataSchema.parse(data),
  examples: [],
});

const snapshot: WorkspaceSnapshot = {
  root: '/',
  id: 'w',
  name: 'W',
  problems: [],
  globals: [],
  environments: [
    {
      id: 'e1',
      name: 'Homologação',
      variables: [
        { key: 'URL_BASE', value: 'https://hml.loja', type: 'default', enabled: true },
        { key: 'TOKEN', type: 'secret', enabled: true, hasValue: true },
      ],
    },
  ],
  collections: [
    {
      kind: 'collection',
      id: 'c1',
      name: 'Loja',
      auth: { type: 'none' },
      variables: [],
      scripts: { preRequest: '', postResponse: '' },
      children: [
        {
          kind: 'folder',
          id: 'f1',
          name: 'Pedidos',
          parentId: 'c1',
          auth: { type: 'inherit' },
          scripts: { preRequest: '', postResponse: '' },
          children: [
            req(
              'r1',
              'Listar pedidos',
              { url: '{{URL_BASE}}/pedidos', query: [{ key: 'status', value: 'aberto' }] },
              'f1',
            ),
            req(
              'r2',
              'Criar pedido',
              {
                method: 'POST',
                url: '{{URL_BASE}}/pedidos',
                body: { mode: 'json', text: '{"cupom":"BLACKFRIDAY"}' },
              },
              'f1',
            ),
          ],
        },
        req('r3', 'Ação de login', { method: 'POST', url: '{{URL_BASE}}/login' }),
      ],
    },
  ],
};

describe('searchWorkspace', () => {
  it('prioriza o nome e mostra o caminho', () => {
    const results = searchWorkspace(snapshot, 'pedidos');
    expect(results.map((r) => r.id).slice(0, 2)).toEqual(['f1', 'r1']);
    expect(results.find((r) => r.id === 'r1')).toMatchObject({ path: 'Loja › Pedidos', method: 'GET' });
  });

  it('exige todos os termos e ignora acentos', () => {
    expect(searchWorkspace(snapshot, 'criar pedido').map((r) => r.id)).toEqual(['r2']);
    // "acao" também está dentro de "Homologação"; o nome que começa com o termo vem primeiro.
    expect(searchWorkspace(snapshot, 'acao').map((r) => r.id)).toEqual(['r3', 'e1']);
  });

  it('encontra pelo conteúdo com trecho', () => {
    const [hit] = searchWorkspace(snapshot, 'blackfriday');
    expect(hit).toMatchObject({ id: 'r2', match: { field: 'body' } });
    expect(hit?.match.snippet).toContain('BLACKFRIDAY');
  });

  it('busca ambientes por nome e variáveis, sem indexar segredos', () => {
    expect(searchWorkspace(snapshot, 'homolog')[0]).toMatchObject({ kind: 'environment', id: 'e1' });
    expect(searchWorkspace(snapshot, 'hml.loja')[0]?.id).toBe('e1');
    expect(searchWorkspace(snapshot, '')).toEqual([]);
  });
});

/**
 * DADOS DE EXEMPLO — apenas para visualizar o layout na Fase 1.
 * Serão substituídos pelo armazenamento real em arquivos na Fase 2.
 */
import type { HttpMethod } from './lib/http-method';

export interface DemoNode {
  id: string;
  name: string;
  kind: 'collection' | 'folder' | 'request';
  method?: HttpMethod;
  children?: DemoNode[];
}

export const DEMO_TREE: DemoNode[] = [
  {
    id: 'c1',
    name: 'API de Pedidos',
    kind: 'collection',
    children: [
      {
        id: 'f1',
        name: 'Autenticação',
        kind: 'folder',
        children: [
          { id: 'r1', name: 'Login', kind: 'request', method: 'POST' },
          { id: 'r2', name: 'Renovar token', kind: 'request', method: 'POST' },
        ],
      },
      {
        id: 'f2',
        name: 'Pedidos',
        kind: 'folder',
        children: [
          { id: 'r3', name: 'Listar pedidos', kind: 'request', method: 'GET' },
          { id: 'r4', name: 'Detalhar pedido', kind: 'request', method: 'GET' },
          { id: 'r5', name: 'Atualizar status', kind: 'request', method: 'PATCH' },
          { id: 'r6', name: 'Substituir pedido', kind: 'request', method: 'PUT' },
          { id: 'r7', name: 'Cancelar pedido', kind: 'request', method: 'DELETE' },
        ],
      },
      { id: 'r8', name: 'Health check', kind: 'request', method: 'HEAD' },
    ],
  },
  { id: 'c2', name: 'Serviço de Catálogo', kind: 'collection', children: [] },
];

export const DEMO_ENVIRONMENTS = [
  { id: 'e1', name: 'Local' },
  { id: 'e2', name: 'Homologação' },
  { id: 'e3', name: 'Produção' },
];

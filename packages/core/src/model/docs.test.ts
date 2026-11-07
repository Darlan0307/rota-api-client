import { describe, expect, it } from 'vitest';
import { documentationPrompt } from './docs';

describe('pedido de documentação para o Claude', () => {
  it('coleção: visão geral nela e cada endpoint na própria requisição', () => {
    const text = documentationPrompt({ kind: 'collection', id: 'c1', name: 'Loja Exemplo' });
    expect(text).toContain('a coleção "Loja Exemplo" (id c1)');
    expect(text).toContain('Na descrição da coleção (atualizar_pasta_ou_colecao)');
    expect(text).toContain('Não liste os endpoints aqui');
    expect(text).toContain('atualizar_requisicao');
  });

  it('pasta e requisição usam o nível certo', () => {
    expect(documentationPrompt({ kind: 'folder', id: 'f1' })).toContain('Na descrição da pasta');
    const request = documentationPrompt({ kind: 'request', id: 'r1', name: 'Login' });
    expect(request).toContain('a requisição "Login" (id r1)');
    expect(request).toContain('campo descricao com atualizar_requisicao');
    expect(request).not.toContain('atualizar_pasta_ou_colecao');
  });
});

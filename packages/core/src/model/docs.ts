/**
 * Pedidos de documentação para o Claude (prompt do MCP e botão "Pedir ao
 * Claude" da tela usam o mesmo texto). O Rota mostra a descrição da
 * coleção/pasta como página e, abaixo, o índice dos endpoints com a descrição
 * de cada requisição; por isso a documentação é dividida nos dois níveis.
 */

export type DocTarget = { kind: 'collection' | 'folder' | 'request'; id: string; name?: string };

const LABEL: Record<DocTarget['kind'], string> = {
  collection: 'a coleção',
  folder: 'a pasta',
  request: 'a requisição',
};

export function documentationPrompt(target: DocTarget): string {
  const which = `${LABEL[target.kind]} ${target.name ? `"${target.name}" ` : ''}(id ${target.id})`;
  if (target.kind === 'request')
    return [
      `Use o MCP do Rota. Leia ${which} com obter_item, incluindo os exemplos salvos e, se houver, o envio mais recente (listar_historico / obter_historico).`,
      'Escreva a documentação em Markdown, em português, e grave no campo descricao com atualizar_requisicao:',
      '- uma frase com o objetivo;',
      '- parâmetros (path, query e headers) numa tabela: nome, obrigatório, descrição;',
      '- corpo de exemplo num bloco ```json (use {{variaveis}} como no editor);',
      '- respostas: status, quando acontece e um exemplo curto;',
      '- erros comuns e como resolver.',
      'Se já houver documentação, melhore sem perder o que estiver certo. Me mostre um resumo no fim.',
    ].join('\n');
  return [
    `Use o MCP do Rota. Leia ${which} com listar_colecoes e obter_item em cada requisição, incluindo os exemplos salvos (gerar_documentacao dá uma base).`,
    'Escreva a documentação em Markdown, em português, em dois níveis:',
    `1. Na descrição ${target.kind === 'folder' ? 'da pasta' : 'da coleção'} (atualizar_pasta_ou_colecao): visão geral, autenticação, variáveis necessárias (tabela) e o fluxo típico (ex.: login → consulta). Não liste os endpoints aqui: o Rota mostra o índice sozinho abaixo deste texto.`,
    '2. Na descrição de cada requisição (atualizar_requisicao, campo descricao): objetivo, parâmetros numa tabela, corpo de exemplo em ```json, respostas e erros comuns.',
    'Se já houver documentação, melhore sem perder o que estiver certo. Me mostre um resumo no fim.',
  ].join('\n');
}

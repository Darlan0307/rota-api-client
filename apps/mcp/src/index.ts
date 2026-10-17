import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpSession } from './session';
import { registerTools } from './tools';
import { registerDocumentationTools } from './tools-docs';

/**
 * Servidor MCP do Rota (stdio). Usa o mesmo core do app: lê e grava o mesmo
 * workspace e pede confirmação no app para ações destrutivas.
 */
export function createServer(session = new McpSession()): McpServer {
  const server = new McpServer(
    { name: 'rota', version: '0.1.0' },
    {
      instructions: [
        'Ferramentas do Rota, um cliente de API (estilo Postman) do usuário.',
        'Use listar_colecoes/buscar para descobrir ids antes de ler ou alterar itens.',
        'Prefira {{variaveis}} de ambiente para URLs base e tokens; nunca escreva segredos literais em requisições.',
        'Para montar uma coleção a partir de documentação, use criar_colecao_completa (tudo numa chamada) ou importar_arquivo (Postman/OpenAPI).',
        'Ao enviar uma requisição com exemplos salvos, o resultado traz "contrato": campos removidos ou com tipo diferente do exemplo.',
        'Valores de variáveis secretas nunca são exibidos (aparecem como ••••••), mas podem ser usados ao enviar requisições.',
        'Editar ou excluir itens, enviar DELETE/PUT/PATCH, rodar teste de carga e esvaziar a lixeira pedem confirmação do usuário no app;',
        'se ele negar ou o app estiver fechado, explique isso ao usuário em vez de tentar de novo.',
      ].join(' '),
    },
  );
  registerTools(server, session);
  registerDocumentationTools(server, session);
  return server;
}

async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

// Executado diretamente (node dist/index.mjs ou via o executável do app).
if (!process.env.VITEST) {
  main().catch((error: unknown) => {
    // stdout é do protocolo MCP; erros vão para stderr.
    process.stderr.write(
      `Erro no servidor MCP do Rota: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exit(1);
  });
}

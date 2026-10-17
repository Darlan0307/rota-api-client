# Projeto: cliente de API desktop pessoal (estilo Postman)

## Contexto

Sou desenvolvedor e uso Postman e Insomnia no dia a dia. Quero construir meu próprio cliente de API para uso pessoal, rodando localmente no Windows 11 como app desktop, com ícone na área de trabalho. O objetivo é ter as funcionalidades que mais uso, uma UI/UX melhor que a do Postman e integração com o Claude via MCP. Não haverá deploy; talvez no futuro vire produto, então mantenha o código organizado e sustentável.

## Como quero que você trabalhe

- **Dúvidas:** se algo estiver ambíguo ou faltar informação, PERGUNTE antes de assumir. Prefiro responder uma pergunta a desfazer uma implementação.
- **Melhorias:** se identificar uma oportunidade de melhoria (funcionalidade, arquitetura, UX, performance, segurança), me apresente a sugestão com prós e contras e NÃO implemente sem minha aprovação. Eu decido se entra ou não.
- **Decisões técnicas:** quando houver mais de um caminho razoável (biblioteca, formato de dados, padrão), explique as opções brevemente e diga qual recomenda.
- **Fases:** implemente uma fase por vez. Ao terminar cada fase, pare e me entregue: o que foi feito, como testar manualmente, pendências e decisões tomadas. Só avance com meu OK.
- **Comunicação:** responda sempre em português do Brasil.
- **Qualidade:** TypeScript em modo strict, código limpo e testes automatizados (Vitest) para a lógica do `core`.

## Stack e arquitetura

- Monorepo com pnpm workspaces:
  - `packages/core`: lógica compartilhada (modelos de dados, armazenamento, resolução de variáveis, execução HTTP, scripts/testes, importação do Postman, geração de código, teste de carga, lixeira).
  - `apps/desktop`: Electron + React + TypeScript, com electron-vite, Tailwind CSS e Monaco Editor para corpos e scripts.
  - `apps/mcp`: servidor MCP (stdio) com `@modelcontextprotocol/sdk`, usando o `core`.
- As requisições HTTP são executadas no processo principal do Electron (Node), nunca no renderer, para evitar CORS. A comunicação entre renderer e main é feita via IPC tipado, com contextIsolation ativo e preload mínimo.
- App e MCP usam o MESMO `core`, para que o Claude faça exatamente o que o app faria.

## Armazenamento

- Dados em arquivos JSON legíveis, organizados para gerar diffs limpos no Git (sugestão: um arquivo por requisição; avalie e proponha).
- **Workspace padrão** em `%APPDATA%`.
- **Coleção por projeto:** posso abrir qualquer pasta (ex.: dentro de um repositório) como workspace; as coleções ficam ali, versionadas junto com o código.
- O app observa os arquivos (ex.: chokidar) e atualiza a interface quando algo muda por fora, inclusive alterações feitas via MCP.

## Funcionalidades da v1

1. **Requisições HTTP:** métodos, URL, query params, headers, body (JSON, raw, form-data com arquivos, x-www-form-urlencoded) e abas para várias requisições abertas.
2. **Resposta:** status, tempo, tamanho, headers e body com JSON formatado e realce de sintaxe, além de visualização raw e busca dentro da resposta.
3. **Coleções e pastas:** criar, renomear, mover (drag and drop), duplicar e excluir.
4. **Autenticação:** Bearer Token, Basic e API Key (header ou query), herdável de pasta ou coleção como no Postman.
5. **Variáveis no padrão do Postman:**
   - Escopos global, coleção e ambiente, com a mesma ordem de prioridade do Postman.
   - Sintaxe `{{variavel}}` com destaque visual e tooltip mostrando o valor resolvido.
   - Seletor de ambiente no canto superior direito, como no Postman.
6. **Variáveis secretas (tipo secret):**
   - Podem existir em qualquer escopo.
   - O valor fica apenas na máquina local, criptografado (Windows Credential Manager/DPAPI, via biblioteca acessível tanto pelo app quanto pelo MCP; proponha qual), fora da pasta do workspace. No arquivo versionado vai só o nome.
   - Na UI aparecem mascaradas, com botão para revelar.
7. **Importação do Postman (apenas Postman):**
   - Coleções v2.1 (e v2.0, se simples), ambientes e variáveis globais exportados.
   - Preservar pastas, autenticação, variáveis, scripts, exemplos e variáveis do tipo secret.
   - Gerar um relatório do que não pôde ser importado ou não é suportado.
8. **Histórico** das requisições enviadas, com busca e opção de reabrir.
9. **Gerar código** a partir da requisição: cURL, fetch e axios, com as variáveis resolvidas (secrets mascarados, com opção de revelar).
10. **Colar cURL:** colar um comando cURL na URL cria a requisição automaticamente.
11. **Scripts e testes:**
    - Script de pré-requisição e de pós-resposta em JavaScript, compatível com o subconjunto mais usado da API `pm.*` do Postman (`pm.environment`, `pm.collectionVariables`, `pm.globals`, `pm.variables`, `pm.request`, `pm.response`, `pm.test`, `pm.expect`).
    - Execução isolada (sandbox, sem acesso a fs/require, com timeout).
    - Resultados dos testes em uma aba (passou/falhou) e saída de `console.log` visível.
12. **Exemplos salvos:** salvar a resposta atual como exemplo nomeado da requisição e consultar depois sem disparar.
13. **Busca global:** coleções, pastas, requisições e ambientes por nome, URL ou conteúdo, com atalho (ex.: Ctrl+P).
14. **Teste de carga simples:**
    - Configurar o total de requisições ou a duração, além da concorrência.
    - Exibir tempo médio, p50/p95/p99, requisições por segundo, taxa de erro e distribuição dos status codes.
    - Permitir cancelar a qualquer momento.
15. **Lixeira:** tudo que for excluído vai para a lixeira, com restauração pela UI. Esvaziar a lixeira exige confirmação.

## Servidor MCP

- O Claude deve poder fazer tudo: listar, ler, buscar, criar, editar e excluir coleções, pastas, requisições, ambientes e variáveis; trocar o ambiente ativo; disparar requisições; consultar o histórico; salvar exemplos; rodar teste de carga; e trabalhar no workspace padrão ou em um workspace de projeto.
- **Confirmação obrigatória no app** (diálogo "O Claude quer [ação]: Permitir / Negar") para qualquer ação destrutiva:
  - Excluir qualquer item (que vai para a lixeira).
  - Editar ou sobrescrever algo existente.
  - Disparar requisições DELETE, PUT ou PATCH.
  - Rodar teste de carga.
  - Esvaziar a lixeira.
- A confirmação precisa acontecer no app, não só no chat. Proponha como o MCP se comunica com o app em execução (ex.: named pipe ou localhost com token) e o que acontece se o app estiver fechado (sugestão: ação destrutiva recusada com mensagem clara).
- **Secrets no MCP:** o Claude pode USAR variáveis secretas para disparar requisições, mas nunca ler os valores. Ele vê só o nome e `••••••`, e os valores secretos devem ser mascarados também nas respostas e no histórico retornados ao MCP.
- Nas configurações do app, um botão que gera ou copia a configuração para adicionar o MCP no Claude Desktop e no Claude Code.

## Design e UI/UX

- Moderno e minimalista, inspirado no layout do Postman, porém com UI/UX melhor: menos poluição visual, hierarquia clara e espaçamento generoso.
- Cor principal: azul escuro ou roxo escuro (proponha uma paleta e me mostre antes de aplicar em tudo).
- Poucas cores na tela: cores fortes apenas com função (status de sucesso/aviso/erro e uma cor discreta por método HTTP).
- Bom contraste, seguindo no mínimo WCAG AA.
- Tema escuro como padrão; tema claro é desejável se não for custoso (me pergunte).
- Tipografia limpa para a interface e fonte monoespaçada para código e respostas.
- Layout: sidebar recolhível (coleções, ambientes, histórico, lixeira), abas de requisição e painéis de requisição e resposta redimensionáveis (lado a lado ou empilhados).
- Atalhos de teclado: Ctrl+Enter envia, Ctrl+S salva, Ctrl+P busca, Ctrl+W fecha a aba.
- Estados vazios, de carregamento e de erro bem cuidados, além de microinterações sutis.

## Empacotamento (Windows 11)

- Instalador com electron-builder (NSIS), com ícone na área de trabalho e no menu Iniciar.
- Proponha um ícone simples e coerente com a paleta.

## Fases

1. Setup do monorepo, base do Electron, layout principal e proposta de paleta (para aprovação).
2. Requisições, resposta, coleções/pastas, autenticação, variáveis e ambientes (incluindo secrets) e armazenamento em arquivos.
3. Importação do Postman.
4. Histórico, gerar código, colar cURL, exemplos salvos e busca global.
5. Scripts e testes no padrão `pm.*`.
6. Lixeira e workspaces de projeto.
7. Teste de carga.
8. Servidor MCP com confirmação no app.
9. Empacotamento, instalador e configuração do MCP.

Antes de começar a Fase 1, leia tudo, me faça as perguntas que tiver e apresente um resumo do plano técnico (estrutura de pastas, bibliotecas principais e formato dos dados) para eu aprovar.

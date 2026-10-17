# Decisões do projeto

Registro das decisões tomadas com o dono do projeto. Atualizar a cada fase.

## Respostas às perguntas iniciais (16/10/2026)

| # | Tema | Decisão |
|---|------|---------|
| 1 | Nome do app | Nome provisório **Rota** (centralizado em `apps/desktop/src/shared/constants.ts`). Aguardando confirmação. |
| 2 | Idioma | Interface só em **português**, sem i18n. |
| 3 | Valor inicial × atual (Postman) | **Não** teremos essa separação: cada variável tem um único valor. |
| 4 | Tema | Só **tema escuro**. |
| 5 | Lixeira de workspace de projeto | Fica em `%APPDATA%` (repositório limpo). |
| 6 | Scripts | Por requisição. Prioridade: script pós-resposta (ex.: login salva o token no ambiente). Scripts em pasta/coleção ficam fora da v1. |
| 7 | Conflito de edição externa | Mostrar aviso **com detalhamento** do que mudou (diff legível) e deixar o usuário decidir: recarregar ou manter a versão local. |
| 8 | Importação do Postman | Somente **v2.1**. Exemplos reais em `./ex-export` (fora do Git, podem conter segredos). |
| 9 | Git | Repositório iniciado; um commit ao fim de cada fase. |

## Sugestões aprovadas

- **Breakdown de tempo** da resposta (DNS, TCP, TLS, TTFB, download) — Fase 2.
- **Configurações de requisição**: verificação SSL, proxy, timeout, seguir redirecionamentos — Fase 2.
- **`.gitignore`/README opcionais** ao abrir uma pasta como workspace de projeto (com confirmação) — Fase 6.

## Decisões técnicas

| Id | Tema | Escolha |
|----|------|---------|
| D1 | Ponte MCP ↔ app | Named pipe + token em `%APPDATA%`, JSON-RPC. App fechado: leituras/criações direto pelo core; ações destrutivas recusadas. |
| D2 | Secrets | **Revisada na Fase 2:** o Credential Manager limita cada valor a ~1280 caracteres (menor que muitos JWTs). Por isso ele guarda só uma **chave mestra AES-256** (via `@napi-rs/keyring`), e os valores ficam cifrados (AES-256-GCM) em `%APPDATA%/Rota/workspaces/<hash>/secrets.json`, fora do workspace. App e MCP leem o mesmo arquivo. |
| D3 | Sandbox de scripts | QuickJS (WASM) com `chai` embutido e timeout. |
| D4 | IPC | Contrato tipado próprio em `apps/desktop/src/shared/ipc.ts`. |
| D5 | Codegen e parser de cURL | Implementação própria. |
| D6 | Importação Postman | Mapeador próprio validado com zod. |
| D7 | Lint/format | Biome. |
| D8 | Scripts em cascata | Coleção e pastas também têm pré/pós-script; ordem coleção → pastas → requisição. Pré-script pode alterar a requisição; alterações de variáveis são gravadas (secretas no cofre). |
| D9 | Servidor MCP | Empacotado com esbuild em `apps/desktop/out/mcp/index.mjs` e executado pelo próprio `Rota.exe` com `ELECTRON_RUN_AS_NODE=1` (não exige Node instalado; lê o bundle de dentro do asar). Ferramentas em português; usa o mesmo workspace aberto no app. |
| D10 | Confirmação no app | Pedida pela ponte (D1) para: editar, excluir, mover, DELETE/PUT/PATCH, teste de carga e esvaziar a lixeira. Tempo limite de ~2 min. |
| D11 | Lixeira | Itens excluídos vão para `%APPDATA%/Rota/workspaces/<hash>/trash` (fora do workspace/Git), com segredos guardados à parte. |
| D12 | Instalador | electron-builder + NSIS, por usuário (sem admin), atalhos na área de trabalho e no Menu Iniciar. Bibliotecas usadas só pelo renderer ficam em devDependencies (já vão no bundle do Vite), o que reduz o asar de ~180 MB para ~44 MB. O binário nativo do keyring fica fora do asar. Sem assinatura de código (o Windows SmartScreen pode avisar na primeira execução). |
| D14 | Duplicar | Não copia os exemplos salvos (nem dentro de pastas/coleções duplicadas). O MCP pode pedir `incluirExemplos`. |
| D15 | Contrato da resposta | Compara a estrutura (campos e tipos) da resposta com o exemplo salvo mais recente de mesmo status; só JSON. Campos ausentes em algum item do exemplo são opcionais. Roda no renderer (os exemplos já estão no snapshot) e também no `enviar_requisicao` do MCP. |
| D16 | Comparar respostas | Diff (Monaco) entre a resposta atual e um exemplo ou envio anterior da mesma requisição; JSON formatado e, por padrão, com campos em ordem alfabética; headers voláteis (date, etag...) ignorados. |
| D17 | OpenAPI/Swagger | Importação de OpenAPI 3.0/3.1 e Swagger 2.0 (JSON ou YAML): pasta por tag, `{{baseUrl}}`, parâmetros de caminho como variáveis da coleção, corpo e respostas de exemplo gerados dos exemplos ou do schema, segurança → auth da coleção com variáveis secretas vazias. |
| D18 | Exportação | Coleções e ambientes para Postman v2.1 e coleção para Markdown. Valores secretos nunca são exportados. |
| D19 | Claude no app | O app não chama a IA: o botão "Claude" copia um pedido pronto para colar no Claude Desktop/Code, que usa o MCP. O MCP ganhou `criar_colecao_completa` (coleção inteira numa chamada, ou em partes com `adicionarEm`), `importar_arquivo`, `gerar_documentacao` e prompts (`colecao_a_partir_de_documentacao`, `gerar_testes`, `explicar_erro`, `documentar_colecao`). |
| D13 | Nome e paleta | Nome "Rota"; paleta padrão "Índigo noturno" (alternativa "Azul profundo"), ambas validadas em WCAG AA nos testes. |

## Formato de dados (implementado na Fase 2)

```
<workspace>/
├─ rota.workspace.json
├─ globals.json
├─ environments/<slug>.env.json
└─ collections/<slug>/
   ├─ _collection.json        # auth, variáveis, ordem dos filhos
   ├─ <pasta>/_folder.json
   ├─ <slug>.req.json
   └─ <slug>.examples/<exemplo>.json
```

- Nome de arquivo = slug do nome (`@rota/core` → `slugify`/`uniqueSlug`); `id` estável dentro do JSON.
- Ordem dos itens em `order: [ids]` no arquivo do pai.
- Secrets: só o nome no arquivo (`"type": "secret"`); valor cifrado localmente (ver D2).
- Histórico, ambiente ativo e estado da UI ficam em `%APPDATA%`, fora do workspace.

## Dados locais (fora do workspace)

```
%APPDATA%/Rota/
├─ settings.json              # timeout padrão, proxy, workspace atual, recentes
├─ workspace/                 # workspace padrão
├─ electron/                  # dados do Chromium (cache, localStorage)
├─ bridge.json                # pipe + token da execução atual (ponte MCP ↔ app)
└─ workspaces/<hash do caminho>/
   ├─ state.json              # ambiente ativo
   ├─ secrets.json            # valores secretos cifrados
   ├─ history.jsonl           # histórico (até 500, segredos mascarados)
   └─ trash/                  # lixeira
```

A variável de ambiente `ROTA_DATA_DIR` substitui `%APPDATA%/Rota` (usada em testes).

## Atalhos

Ctrl+Enter enviar · Ctrl+S salvar · Ctrl+P buscar · Ctrl+W fechar aba · Ctrl+T nova aba · Ctrl+B recolher sidebar · Ctrl+Tab próxima aba · Ctrl+, configurações · Ctrl+E (ou F2) renomear item · Ctrl+D duplicar item · Del excluir item.

Ctrl+E e Ctrl+D agem sobre o item focado na sidebar ou, se o foco estiver em outro lugar, sobre o item da aba ativa. Dentro do editor de código (Monaco) as teclas mantêm o comportamento do editor.

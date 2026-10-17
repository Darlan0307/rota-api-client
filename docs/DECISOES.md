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
└─ workspaces/<hash do caminho>/
   ├─ state.json              # ambiente ativo
   └─ secrets.json            # valores secretos cifrados
```

A variável de ambiente `ROTA_DATA_DIR` substitui `%APPDATA%/Rota` (usada em testes).

## Atalhos

Ctrl+Enter enviar · Ctrl+S salvar · Ctrl+P buscar · Ctrl+W fechar aba · Ctrl+T nova aba · Ctrl+B recolher sidebar · Ctrl+Tab próxima aba · Ctrl+, configurações · F2 renomear item · Del excluir item.

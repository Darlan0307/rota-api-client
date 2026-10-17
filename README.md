# Rota

Cliente de API desktop pessoal (estilo Postman) para Windows, com integração ao Claude via MCP.

## Instalar

```sh
pnpm install
pnpm --filter @rota/desktop dist
```

O instalador fica em `apps/desktop/release/Rota-Setup-<versão>.exe`. Ele instala para o usuário atual (sem administrador), permite escolher a pasta e cria atalhos na **área de trabalho** e no **Menu Iniciar**. Desinstalar não apaga seus dados em `%APPDATA%\Rota`.

## Conectar ao Claude (MCP)

No app: **Configurações → Claude (MCP)**.

- **Claude Desktop:** botão "Configurar automaticamente" (inclui o Rota em `claude_desktop_config.json`, guarda cópia do arquivo anterior). Reinicie o Claude Desktop depois.
- **Claude Code:** copie o comando `claude mcp add rota ...` mostrado na tela.

O servidor roda com o próprio `Rota.exe` (modo Node), sem precisar de Node instalado. Ações que alteram ou apagam dados, requisições DELETE/PUT/PATCH e testes de carga pedem confirmação no app — com o app fechado, essas ações são recusadas. Valores secretos nunca são enviados ao Claude.

## Desenvolvimento

Requisitos: Node 22+ e pnpm 10+.

```sh
pnpm dev            # abre o app em modo desenvolvimento (F5 recarrega, F12 abre o DevTools)
pnpm test           # testes (Vitest) de todos os pacotes
pnpm typecheck      # checagem de tipos (TypeScript strict)
pnpm lint           # lint + formatação (Biome)
pnpm format         # aplica correções automáticas do Biome
pnpm build          # build de produção (app + servidor MCP em apps/desktop/out)
pnpm --filter @rota/desktop dist:dir   # app empacotado sem instalador (release/win-unpacked)
pnpm --filter @rota/desktop dist   # instalador NSIS
pnpm --filter @rota/desktop icon   # regenera build/icon.ico e icon.png a partir de icon.svg
```

Para testar o MCP empacotado: `node apps/mcp/scripts/smoke-packaged.mjs <caminho do Rota.exe> <pasta de dados de teste>`.

## Estrutura

- `packages/core` — lógica compartilhada entre o app e o servidor MCP (workspace, variáveis, HTTP, scripts, importação, histórico, lixeira, teste de carga, ponte com o app).
- `apps/desktop` — app Electron + React + Tailwind.
- `apps/mcp` — servidor MCP (empacotado com esbuild em `apps/desktop/out/mcp`).
- `docs/DECISOES.md` — decisões de produto e técnicas.
- `PLANO.md` — plano original do projeto.

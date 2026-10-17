# Rota

Cliente de API desktop pessoal (estilo Postman) para Windows, com integração ao Claude via MCP.

## Requisitos

- Node 22+
- pnpm 10+

## Comandos

```sh
pnpm install        # instala dependências
pnpm dev            # abre o app em modo desenvolvimento (F5 recarrega, F12 abre o DevTools)
pnpm test           # testes (Vitest) de todos os pacotes
pnpm typecheck      # checagem de tipos (TypeScript strict)
pnpm lint           # lint + formatação (Biome)
pnpm format         # aplica correções automáticas do Biome
pnpm build          # build de produção
```

## Estrutura

- `packages/core` — lógica compartilhada entre o app e o servidor MCP.
- `apps/desktop` — app Electron + React + Tailwind.
- `apps/mcp` — servidor MCP (Fase 8).
- `docs/DECISOES.md` — decisões de produto e técnicas.
- `PLANO.md` — plano original do projeto.

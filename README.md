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

## Do dia a dia

- **Importar:** Postman (coleções v2.1, ambientes, globais) e OpenAPI 3 / Swagger 2.0 (JSON ou YAML).
- **Exportar:** botão direito na coleção → Postman (v2.1) ou documentação em Markdown; ambientes → Postman. Valores secretos nunca vão para os arquivos.
- **Exportar tudo (backup):** ícone de arquivo na barra de coleções ou de ambientes. Salva todas as coleções, ambientes e globais numa pasta, no formato do Postman, com um LEIA-ME. Os segredos só vão (em texto puro) se você marcar a opção.
- **Contrato:** salve uma resposta boa como exemplo; nas próximas, a aba "Contrato" avisa se um campo sumiu ou mudou de tipo.
- **Comparar:** diff da resposta atual com um exemplo ou um envio anterior.
- **Claude:** o botão "Claude" na requisição copia pedidos prontos (gerar testes, explicar erro, documentar a coleção).
- **Dados de teste:** `{{$cpf}}`, `{{$cnpj}}`, `{{$nomeCompleto}}`, `{{$email}}`, `{{$celular}}`, `{{$cep}}`, `{{$placa}}`, `{{$hoje}}`... geram um valor novo a cada envio (CPF/CNPJ válidos). Digite `{{$` num campo ou abra a lista pelo ícone de dado no topo da requisição.
- **Salvar em variável:** clique num campo do JSON da resposta (ou numa célula da tabela) e use "Salvar em variável". O valor é gravado na hora e, se quiser, o pós-script passa a atualizá-lo a cada envio.
- **Tabela:** listas da resposta viram tabela com ordenação, filtro e exportação para CSV.
- **Desfazer:** excluir, mover, renomear ou duplicar mostra "Desfazer" (ou Ctrl+Z fora de campos de texto).
- **Túneis (webhooks):** ícone de webhook na barra lateral. Cria uma URL `https://….trycloudflare.com` que entrega as chamadas na porta da sua API (3000, 8080…), mostra cada chamada (pedido e resposta) e permite reenviar ou abrir como requisição. Um túnel por API; o botão "Como usar" tem o passo a passo.

### Criar uma coleção a partir de uma documentação

Com o MCP configurado, anexe a documentação (JSON, OpenAPI, PDF convertido...) numa conversa com o Claude e use o prompt **colecao_a_partir_de_documentacao** (ou peça "crie a coleção desta documentação no Rota"). O Claude monta tudo com `criar_colecao_completa`: pastas, requisições com `{{baseUrl}}`, exemplos de resposta e auth com variáveis secretas vazias para você preencher no app. Se o arquivo for OpenAPI, ele pode usar `importar_arquivo` direto.

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

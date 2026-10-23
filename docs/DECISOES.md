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
| D20 | Dados de teste | Variáveis dinâmicas brasileiras (`{{$cpf}}`, `{{$cnpj}}`, `{{$nomeCompleto}}`, `{{$celular}}`, `{{$cep}}`, `{{$placa}}`, datas...) com CPF/CNPJ de dígitos válidos; cada ocorrência gera um valor novo a cada envio, como no Postman. Alguns nomes do Postman (`$randomEmail`...) continuam funcionando. Lista com exemplos no botão de dados de teste da requisição e ao digitar `{{$`. |
| D21 | Salvar em variável | Clicar num campo do JSON (ou numa célula da tabela) mostra o caminho; "Salvar em variável" grava o valor agora e, se marcado, inclui no pós-script `if (pm.response.code < 400) pm.<escopo>.set(...)`. A condição evita quebrar o script (e apagar o valor bom) quando a resposta é de erro. Linha repetida para a mesma variável é substituída. Nomes com token/senha/secret sugerem variável secreta. |
| D22 | Tabela | Listas de objetos da resposta (na raiz ou em campos como `data.items`, até 3 níveis) viram tabela com ordenação, filtro e exportação CSV (`;` e BOM UTF-8, para o Excel em português). Mostra até 500 linhas; o CSV leva todas as filtradas. |
| D23 | Desfazer | Excluir, mover, renomear, reordenar e duplicar mostram "Desfazer" por 6 s; Ctrl+Z (fora de campos de texto) vale por até 1 min. Excluir requisição ou exemplo não pede mais confirmação (dá para desfazer); coleção, pasta e ambiente continuam pedindo. |
| D24 | Túneis (webhooks) | "Quick tunnel" do cloudflared (gratuito, sem conta): o Rota não mantém servidor próprio. O cloudflared oficial é baixado do GitHub da Cloudflare para `%APPDATA%/Rota/bin` (ou usado do PATH, se instalado). Caminho: Cloudflare → cloudflared → proxy do Rota em 127.0.0.1 (registra pedido/resposta, até 1 MB por corpo e 200 chamadas, só na memória) → API local. Destino e modo mudam com o túnel ligado (a URL não muda). Modo "Só capturar" responde sem chamar a API. Configurações em `%APPDATA%/Rota/tunnels.json` (são da máquina, não do projeto). Fechar o app desliga todos os túneis. |
| D25 | Backup | "Exportar tudo" grava numa pasta nova (`Rota-backup-AAAA-MM-DD_HHhMM`) um arquivo Postman por coleção e ambiente, as globais e um LEIA-ME. Segredos vão vazios por padrão; com a opção marcada (desmarcada a cada abertura, com aviso), vão em texto puro, porque sem isso se perdem ao reinstalar o Windows (a chave fica no cofre do Windows). Reimportar devolve os segredos como secretos. |
| D26 | Fechar o app | Fechar a janela encerra tudo: no before-quit o app esconde a janela, para os túneis (cloudflared), a ponte MCP e o vigia de arquivos e chama app.exit (limite de 3 s, para nada travado segurar o processo). Sem bandeja nem segundo plano. Os PIDs dos cloudflared ficam em tunnels.pids.json; se o app for morto à força, a próxima abertura encerra os que sobraram (só se o PID ainda for cloudflared.exe). Verificado no app empacotado: 0 processos Rota/cloudflared depois de fechar. |
| D27 | Simulador de webhooks | Catálogo em `core/webhooks` (Stripe, Mercado Pago, GitHub, Asaas, Shopify, Standard Webhooks/Svix e HMAC genérico) com eventos de exemplo que usam dados de teste. O envio sai direto para a API local pelo proxy do túnel (aparece na lista de chamadas e não precisa do túnel ligado), assinado como o provedor faria; o corpo aceita `{{variáveis}}` do ambiente ativo. O segredo de cada túnel fica cifrado em `%APPDATA%/Rota/app-secrets.json` (mesma chave mestra do cofre do Windows) e nunca volta para a tela. Com provedor e segredo configurados, as chamadas recebidas mostram se a assinatura confere, o que separa "segredo errado" de "código de validação errado". "Editar e reenviar" reassina uma chamada recebida, útil porque o Stripe recusa assinaturas com mais de 5 minutos. |
| D28 | Firebird (protótipo) | `node-firebird` (JavaScript puro, MPL-2.0): fala o protocolo de rede do Firebird, sem cliente instalado; testado com 2.5 em Docker (`packages/core/scripts/firebird/setup.mjs`) e dentro do Rota.exe empacotado. Charset "auto": lê o charset do banco; NONE (bancos antigos que gravam bytes do Windows) conecta como WIN1252, os demais em UTF8 com conversão no servidor. Somente leitura em duas camadas: o comando é preparado antes e só SELECT passa; roda em transação READ ONLY (o servidor recusa escrita). GEN_ID e NEXT VALUE FOR são recusados à parte, porque avançam generators mesmo em transação READ ONLY. Resultados limitados (500 linhas por padrão) lidos em streaming; datas formatadas no horário local; BIGINT fora da faixa segura do JavaScript vira texto exato; BLOB de texto vem como texto. |
| D29 | Bancos de dados (tela) | Seção "Bancos de dados" com conexões da máquina (`%APPDATA%/Rota/databases.json`, fora do projeto) e senhas no cofre (`app-secrets.json`). "Credenciais salvas" guardam usuário e senha uma vez para várias conexões; trocar a senha ali vale para todas. O acesso é direto por endereço e porta: o app não abre túnel. Ambientes Local/Teste/Produção: produção nasce somente leitura e, se a escrita for liberada, comandos que não são SELECT pedem confirmação. Ctrl+Enter roda a seleção ou o comando sob o cursor; o autocomplete resolve aliases de FROM/JOIN. Firebird 2.5 não cifra a conexão (isso só existe a partir do 3.0): dados e consultas trafegam sem criptografia pela internet; para bancos sensíveis, prefira VPN. |
| D30 | Outros bancos | PostgreSQL (`pg` + `pg-cursor`), MySQL/MariaDB (`mysql2`) e SQL Server (`mssql`), todos em JavaScript puro e MIT, atrás da mesma interface (`DbSession`). Somente leitura: Postgres e MySQL rodam numa transação READ ONLY desfeita no fim (o servidor recusa escrita; no Postgres isso bloqueia até `nextval`), e o Postgres usa o protocolo estendido, que aceita um comando por vez. Por cima, o Rota só aceita comandos que começam com SELECT/WITH/SHOW/EXPLAIN e recusa palavras de escrita ou execução em qualquer ponto (fora de textos e comentários), incluindo `SELECT INTO` e `INTO OUTFILE`. O SQL Server não tem transação somente leitura: lá a proteção é essa trava mais uma transação sempre desfeita, e a tela recomenda um usuário `db_datareader`. Limite de linhas por cursor (Postgres), cancelamento no servidor (`KILL QUERY` no MySQL, esperando o KILL terminar antes de liberar a sessão) ou do próprio pedido (SQL Server). Datas como o banco gravou, sem conversão de fuso; números grandes ficam exatos. Testes de integração com Docker em `packages/core/scripts/databases/setup.mjs`. |
| D31 | Uso das conexões de banco | Fechar a aba de uma conexão desconecta, e conexões paradas há 15 minutos são fechadas sozinhas (não deixa sessão aberta em produção nem ocupa o servidor do cliente). Histórico de consultas por conexão em `%APPDATA%/Rota/database-history/<id>.json` (só nesta máquina, até 200, a mesma consulta não se repete); executar pelo histórico passa pela mesma confirmação de produção. Copiar resultado (linhas filtradas) como JSON, tabela para o Excel (tabulação) ou INSERT na sintaxe do banco, com a tabela tirada do FROM. Ao cair a conexão, só consultas de leitura são repetidas automaticamente: um comando que grava pode ter sido aplicado antes da queda. |
| D32 | Segredos pelo MCP | `enviar_requisicao` pede confirmação no app quando a requisição final (depois dos pré-scripts) leva um valor secreto para um endereço que o usuário nunca usou: confiáveis são a própria máquina, hosts já enviados pelo app (histórico) e os aprovados na sessão do MCP. Requisição salva não conta, porque o Claude pode criá-la sem confirmação. Evita que instruções escondidas numa resposta de API façam o Claude mandar um token para fora. |
| D33 | Workspaces | "Novo workspace" cria uma pasta em `%APPDATA%/Rota/meus-workspaces/<nome>` (sem escolher pasta); o embutido passou a se chamar "Workspace principal". Todos ficam na lista do menu (antes "Recentes", agora até 30). A estrela marca o padrão, que abre ao iniciar o app (`startupWorkspace` no settings.json); sem padrão, abre o último usado. Remover da lista não apaga a pasta. |
| D34 | JSON com variáveis | Como no Postman, o corpo JSON aceita `{{VAR}}` sem aspas (`"Id": {{ID}}`). O validador do Monaco foi desligado (marcava "End of file expected" nessas variáveis) e o Rota valida com `jsonSyntaxError` (core/http/json-template), que troca as variáveis por um valor do mesmo tamanho e aponta o erro real em português; "Formatar" mantém as variáveis. O corpo continua indo exatamente como foi escrito; se ficar inválido depois de trocar as variáveis (ex.: um GUID sem aspas), a resposta mostra um aviso com linha e coluna, porque muitas APIs tratam JSON quebrado como texto. |
| D35 | Popover de variável | Passar o mouse numa `{{variável}}` (campos e editor) abre um popover com o valor, de onde ela vem e "Editar" (grava no escopo de origem pelo comando `setVariable`); variável inexistente pode ser criada no ambiente, na coleção ou nas globais. Secretas aparecem mascaradas: o olho busca o valor no processo principal (`secrets:reveal`) só ao clicar, ele fica só no estado do popover e some ao fechar. Valores longos (tokens) rolam numa caixa de altura limitada, com botão de copiar. |
| D36 | Seleção múltipla | Ctrl+clique marca pastas e requisições (coleções não); o primeiro leva junto o item aberto, como no Explorer. Arrastar um marcado move todos para o fim da pasta ou coleção de destino, na ordem da árvore, com um único "Desfazer"; itens dentro de uma pasta marcada vão com ela. Barra com a contagem, Excluir e Limpar (Esc também limpa). |
| D37 | Verificação do MCP | Uma vez por execução do app (`mcp:status`, memorizado no processo principal) o Rota inicia o servidor MCP como o Claude faria e pede `tools/list`; nada de verificação periódica, e nenhuma chamada ao Claude. O Claude Desktop recente guarda os dados fora do pacote, em `%LOCALAPPDATA%\Claude-Data\claude_*` (prioridade). O MSIX mais antigo lê a cópia do arquivo dentro do pacote (`%LOCALAPPDATA%\Packages\Claude_*\LocalCache`) antes do `%APPDATA%` real, então o Rota grava onde o Claude vai ler. No Claude Code, todas as pastas `~/.claude*` são verificadas, porque o `claude mcp add` grava só na pasta de configuração ativa no terminal. |
| D38 | Confirmações do MCP | Cada confirmação tem uma categoria: organizar (renomear, mover), editar (requisição, pasta, coleção, variável comum), excluir (lixeira, remover variável, trocar valor de secreta), enviar PUT/PATCH/DELETE e crítica (esvaziar lixeira, teste de carga, segredo para endereço novo). Em Configurações → Claude cada categoria pode passar sem perguntar (padrão: organizar e editar ligados; excluir e enviar desligados); a crítica sempre pergunta. No diálogo, "Não perguntar de novo" libera a categoria até fechar o app, inclusive as que já estavam na fila. Quem decide é o processo principal do app, não o servidor MCP: o Claude não tem ferramenta para mudar essas regras. Categoria ausente ou desconhecida na ponte vira crítica. Com o app fechado nada é liberado (a ponte não responde), como em D1. Editar sem perguntar não abre brecha para segredos: o envio continua conferindo o endereço final (D32). |
| D38 | Abas fixadas | `pinned` na aba (persistido junto). Fixadas ficam sempre antes das outras (arrastar não cruza a fronteira) e não fecham por Ctrl+W, clique do meio, "Fechar as outras" ou "Fechar todas"; só pelo menu "Fechar (aba fixada)". "Fechar todas" com várias abas alteradas pergunta uma vez (descartar e fechar) em vez de um diálogo por aba. |
| D39 | Colar URL de conexão | `parseConnectionString` (core/database, sem Node) lê URL (`postgresql://`, `mysql://`, `sqlserver://`, `firebird://`, com ou sem `jdbc:`), chave=valor do .NET/Npgsql/MySQL e o formato clássico do Firebird (`servidor/3050:caminho`). Preenche o formulário e some do campo: a senha vai só para o campo de senha (salva cifrada, como sempre) e o texto colado não é guardado. Login do Windows e instância nomeada do SQL Server viram avisos, porque o Rota conecta com usuário/senha e por porta. |
| D40 | Envios anteriores na aba | O histórico já guardava cada envio com `requestId`; a aba só passa a exibir um deles: o `RunResult` do histórico entra em `run.result` com `run.viewing` (data, origem, a requisição daquele envio e a resposta mais recente para voltar). Testes, console e contrato mostram o envio escolhido sem código extra. "Restaurar" troca o rascunho inteiro (com Desfazer) e "Comparar" volta à resposta atual e abre o comparador apontando para aquele envio. |
| D41 | Dados de teste no corpo | `suggestTestData` (core/variables/fill) varre o JSON (aceitando `{{VAR}}` sem aspas) guardando a posição de cada valor e troca só os escolhidos no texto original, de trás para frente: formatação e o resto do corpo ficam iguais. Nomes ambíguos ("nome", "estado") só valem em objeto que pareça pessoa ou endereço (chave do pai ou chaves irmãs), para não trocar o nome de um produto por nome de pessoa. |
| D42 | Tipos a partir de dados | TypeScript, Zod e JSON Schema saem da mesma forma usada no contrato (`inferShape`/`mergeShapes`): campo que falta em parte dos itens vira opcional. Um tipo por objeto aninhado, com nome singular aproximado ("itens" → `Item`). Tabela gera só TypeScript, com os tipos naturais (o driver do projeto pode entregar datas e decimais de outro jeito; o diálogo avisa). |
| D43 | Consultas internas no banco | `db:run` aceita `{ history: false }`: amostras e perfil passam pela mesma trava de somente leitura, mas não poluem o histórico de consultas. |
| D44 | Perfil da tabela | Core só gera SQL e lê resultados (`profileTable` recebe a função que executa), então o mesmo código roda na tela e no teste de integração dos 4 bancos. Acima de 10.000 linhas usa as primeiras (FIRST/TOP/LIMIT) e avisa. Agregados em lotes de 20 colunas; tipos que o banco não agrega (BLOB, JSON, XML, bit, uuid) ficam só com a contagem ou sem MIN/MAX; lote com erro refaz coluna a coluna. Valores mais comuns só para colunas que se repetem. |
| D45 | Eventos salvos do simulador | Ficam em `webhook.savedEvents` do túnel (tunnels.json, só nesta máquina), com o modelo de evento do provedor para repetir os headers fixos. Limite de 50 por túnel e 256 KB por corpo. Ao salvar, avisa se o payload parece ter CPF, e-mail ou celular. |
| D46 | Pacote de contexto | Montado à mão e só em memória (como as respostas das abas). Requisições entram como estão no editor (`{{variáveis}}`), headers sensíveis digitados direto viram ••••••, listas longas e corpos grandes são encurtados. Antes de sair do app (copiar ou salvar), o processo principal troca todo valor secreto conhecido do workspace (todas as coleções e ambientes) por ••••••. Nada passa pelo MCP. |
| D47 | Fila de consultas por conexão | `DatabaseService` executa uma consulta por vez em cada sessão (estrutura, editor, amostras, perfil). Os drivers até aceitam duas ao mesmo tempo, mas o KILL QUERY do limite no MySQL derruba o que estiver rodando na conexão, e o perfil roda junto com o editor. O botão Cancelar do editor cancela o perfil inteiro quando ele está rodando. |
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
├─ workspace/                 # workspace principal
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

Ctrl+Enter enviar · Ctrl+S salvar · Ctrl+P buscar · Ctrl+W fechar aba · Ctrl+T nova aba · Ctrl+B recolher sidebar · Ctrl+Tab próxima aba · Ctrl+, configurações · Ctrl+E (ou F2) renomear item · Ctrl+D duplicar item · Del excluir item · Ctrl+Z desfazer a última ação na árvore.

Ctrl+E e Ctrl+D agem sobre o item focado na sidebar ou, se o foco estiver em outro lugar, sobre o item da aba ativa. Dentro do editor de código (Monaco) as teclas mantêm o comportamento do editor.

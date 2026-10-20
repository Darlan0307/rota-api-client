/**
 * Contrato tipado da comunicação renderer <-> main.
 *
 * - `IpcContract`: chamadas renderer -> main (invoke), com argumentos e retorno.
 * - `IpcEvents`: eventos main -> renderer.
 *
 * O preload só repassa canais listados em IPC_CHANNELS / IPC_EVENTS. Para
 * adicionar um canal: declare aqui, inclua na lista e registre em src/main/ipc.ts.
 */
import type {
  AppSettings,
  Auth,
  CodegenTarget,
  DbConnectionConfig,
  DbCredential,
  DbHistoryEntry,
  DbQueryResult,
  DbSchema,
  DbServerInfo,
  DbState,
  FolderInspection,
  HistoryEntry,
  HistorySummary,
  HttpResponse,
  ImportPreview,
  ImportReport,
  LoadTestConfig,
  LoadTestResult,
  LoadTestStats,
  PreparedRequest,
  RequestData,
  RunResult,
  Scripts,
  TrashEntry,
  TunnelConfig,
  TunnelExchange,
  TunnelExchangeSummary,
  TunnelView,
  VariableInput,
  VariableTarget,
  WorkspaceSnapshot,
} from '@rota/core/shared';

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  userDataPath: string;
}

export interface TitleBarColors {
  color: string;
  symbolColor: string;
}

/** Estado do workspace aberto, enviado ao renderer a cada mudança. */
export interface WorkspaceState {
  snapshot: WorkspaceSnapshot;
  activeEnvironmentId: string | null;
  /** true quando é o workspace padrão em %APPDATA%. */
  isDefault: boolean;
}

/** Alterações no workspace. Mesmas operações que o MCP terá. */
export type WorkspaceCommand =
  | { type: 'createCollection'; name: string }
  | { type: 'createFolder'; parentId: string; name: string; index?: number }
  | { type: 'createRequest'; parentId: string; name: string; data?: RequestData; index?: number }
  | { type: 'updateRequest'; id: string; data: RequestData }
  | {
      type: 'updateCollection';
      id: string;
      auth?: Auth;
      description?: string;
      variables?: VariableInput[];
      scripts?: Scripts;
    }
  | { type: 'updateFolder'; id: string; auth?: Auth; description?: string; scripts?: Scripts }
  | { type: 'rename'; id: string; name: string }
  | { type: 'move'; id: string; parentId: string; index?: number }
  | { type: 'duplicate'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'reorderCollections'; order: string[] }
  | { type: 'createEnvironment'; name: string }
  | { type: 'updateEnvironment'; id: string; variables: VariableInput[] }
  | { type: 'updateGlobals'; variables: VariableInput[] }
  /** Valor de uma variável (cria se não existir); secreta continua secreta, com o valor no cofre. */
  | { type: 'setVariable'; target: VariableTarget; key: string; value: string };

export interface CommandResult {
  /** Id do item criado/duplicado ou, ao excluir, da entrada na lixeira. */
  id?: string;
}

export interface SendRequestInput {
  /** Id único deste envio (para cancelar). */
  runId: string;
  requestId?: string | undefined;
  parentId?: string | undefined;
  /** Nome exibido no histórico. */
  name: string;
  data: RequestData;
}

export interface CodegenInput {
  requestId?: string | undefined;
  parentId?: string | undefined;
  data: RequestData;
  target: CodegenTarget;
  /** Mostra os valores reais das variáveis secretas. */
  reveal: boolean;
}

export interface LoadTestInput {
  runId: string;
  requestId?: string | undefined;
  parentId?: string | undefined;
  data: RequestData;
  config: LoadTestConfig;
}

/** Como o Claude inicia o servidor MCP do Rota. */
export interface McpLaunchConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface McpSetupInfo {
  config: McpLaunchConfig;
  /** Trecho para claude_desktop_config.json. */
  desktopSnippet: string;
  /** Comando para o Claude Code. */
  claudeCodeCommand: string;
  claudeDesktop: {
    path: string;
    status: 'missing' | 'not-installed' | 'installed' | 'outdated' | 'invalid';
  };
  /** Rodando pelo código-fonte (pnpm dev): o caminho muda se o projeto mudar de lugar. */
  development: boolean;
}

export interface McpConfirmRequest {
  id: string;
  title: string;
  description: string;
  details: string[];
  danger: boolean;
}

export interface SaveExampleInput {
  requestId: string;
  name: string;
  request: PreparedRequest | null;
  response: HttpResponse;
}

export interface CloudflaredInfo {
  installed: boolean;
  path: string | null;
  /** "app": baixado pelo Rota; "path": já instalado no Windows. */
  source: 'app' | 'path' | null;
}

export interface BackupResult {
  folder: string;
  files: number;
  collections: number;
  environments: number;
  secretsIncluded: number;
  secretsTotal: number;
}

export interface IpcContract {
  'app:getInfo': { args: []; result: AppInfo };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno; `void` aceita handlers sem `return`
  'window:setTitleBarColors': { args: [colors: TitleBarColors]; result: void };

  'settings:get': { args: []; result: AppSettings };
  'settings:update': { args: [patch: Partial<AppSettings>]; result: AppSettings };

  'workspace:get': { args: []; result: WorkspaceState };
  'workspace:command': { args: [command: WorkspaceCommand]; result: CommandResult };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'workspace:setActiveEnvironment': { args: [id: string | null]; result: void };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'workspace:revealInExplorer': { args: [id?: string]; result: void };

  'secrets:reveal': { args: [target: VariableTarget, key: string]; result: string | null };

  'request:send': { args: [input: SendRequestInput]; result: RunResult };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'request:cancel': { args: [runId: string]; result: void };

  'dialog:openFiles': { args: [options: { multiple?: boolean; title?: string }]; result: string[] };

  /** Seleciona arquivos .json exportados do Postman. */
  'import:pickFiles': { args: []; result: string[] };
  'import:preview': { args: [paths: string[]]; result: ImportPreview[] };
  'import:run': { args: [paths: string[], secretKeys: Record<string, string[]>]; result: ImportReport };

  'history:list': {
    /** requestId: só os envios dessa requisição. */
    args: [query: string, limit: number, requestId?: string];
    result: { items: HistorySummary[]; total: number };
  };
  'history:get': { args: [id: string]; result: HistoryEntry | null };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'history:remove': { args: [id: string]; result: void };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'history:clear': { args: []; result: void };

  'codegen:generate': { args: [input: CodegenInput]; result: string };

  /** Exporta uma coleção (Postman v2.1 ou documentação Markdown). Devolve o arquivo salvo (null = cancelado). */
  'export:collection': { args: [id: string, format: 'postman' | 'markdown']; result: string | null };
  /**
   * Backup: todas as coleções, ambientes e globais (formato Postman) numa pasta
   * escolhida pelo usuário. Segredos só com includeSecrets (texto puro!). null = cancelado.
   */
  'export:all': { args: [includeSecrets: boolean]; result: BackupResult | null };
  /** Salva uma tabela da resposta em CSV (nome sugerido sem extensão). */
  'export:csv': { args: [name: string, csv: string]; result: string | null };
  /** Exporta um ambiente (ou as globais, com id null) no formato do Postman. */
  'export:variables': { args: [id: string | null]; result: string | null };

  /** Resolve ao terminar (ou ser cancelado); o progresso chega por 'loadtest:progress'. */
  'loadtest:start': { args: [input: LoadTestInput]; result: LoadTestResult };

  /** Resposta do usuário a uma confirmação pedida pelo Claude (MCP). */
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'mcp:respond': { args: [id: string, approved: boolean]; result: void };
  'mcp:setup': { args: []; result: McpSetupInfo };
  /** Inclui o Rota no Claude Desktop (com cópia de segurança do arquivo). */
  'mcp:installClaudeDesktop': { args: []; result: { backupPath: string | null } };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'loadtest:cancel': { args: [runId: string]; result: void };

  'trash:list': { args: []; result: TrashEntry[] };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'trash:restore': { args: [id: string]; result: void };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'trash:remove': { args: [id: string]; result: void };
  'trash:empty': { args: []; result: number };

  /** Escolhe uma pasta para abrir como workspace (null = cancelado). */
  'workspace:pickFolder': { args: []; result: string | null };
  'workspace:inspectFolder': { args: [path: string]; result: FolderInspection };
  /** Abre um workspace (null = padrão), preparando .gitignore/README se pedido. */
  'workspace:open': {
    args: [path: string | null, prepare?: { gitignore: boolean; readme: boolean }];
    result: WorkspaceState;
  };
  'workspace:recent': { args: []; result: { current: string | null; recent: string[] } };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'workspace:forgetRecent': { args: [path: string]; result: void };
  'examples:save': { args: [input: SaveExampleInput]; result: string };

  'tunnel:list': { args: []; result: TunnelView[] };
  'tunnel:binary': { args: []; result: CloudflaredInfo };
  /** Baixa o cloudflared; o progresso chega por 'tunnel:download'. */
  'tunnel:install': { args: []; result: CloudflaredInfo };
  'tunnel:create': { args: [patch?: Partial<TunnelConfig>]; result: string };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'tunnel:update': { args: [id: string, patch: Partial<Omit<TunnelConfig, 'id'>>]; result: void };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'tunnel:remove': { args: [id: string]; result: void };
  /** Resolve quando a URL pública já responde (até ~45 s); false = cancelado. */
  'tunnel:start': { args: [id: string]; result: boolean };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'tunnel:stop': { args: [id: string]; result: void };
  'tunnel:exchange': { args: [id: string, exchangeId: string]; result: TunnelExchange | null };
  /** POST de teste pela URL pública (ponta a ponta). */
  'tunnel:test': { args: [id: string, path?: string]; result: { status: number; url: string } };
  'tunnel:replay': { args: [id: string, exchangeId: string]; result: TunnelExchangeSummary };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'tunnel:clear': { args: [id: string]; result: void };
  /** Segredo do webhook (null apaga). Fica cifrado; a tela só recebe hasWebhookSecret. */
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'tunnel:setWebhookSecret': { args: [id: string, value: string | null]; result: void };
  /** Envia um webhook simulado e assinado direto para a API local. */
  'tunnel:simulate': {
    args: [id: string, input: { body: string; path: string; eventId?: string }];
    result: TunnelExchangeSummary;
  };

  'db:state': { args: []; result: DbState };
  /** Cria ou atualiza; password undefined mantém a senha salva, null apaga. */
  'db:saveConnection': {
    args: [input: Partial<DbConnectionConfig>, password?: string | null];
    result: string;
  };
  'db:duplicateConnection': { args: [id: string]; result: string };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'db:removeConnection': { args: [id: string]; result: void };
  'db:saveCredential': { args: [input: Partial<DbCredential>, password?: string | null]; result: string };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'db:removeCredential': { args: [id: string]; result: void };
  /** Testa os dados da tela (sem salvar); sem senha, usa a salva. */
  'db:test': {
    args: [input: Partial<DbConnectionConfig>, password?: string];
    result: DbServerInfo;
  };
  'db:connect': { args: [id: string]; result: DbServerInfo };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'db:disconnect': { args: [id: string]; result: void };
  'db:schema': { args: [id: string]; result: DbSchema };
  'db:run': { args: [id: string, sql: string, limit?: number]; result: DbQueryResult };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'db:cancel': { args: [id: string]; result: void };
  /** Consultas executadas na conexão (mais recentes primeiro). */
  'db:history': { args: [id: string]; result: DbHistoryEntry[] };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'db:clearHistory': { args: [id: string]; result: void };
}

export interface IpcEvents {
  'workspace:changed': WorkspaceState;
  /** O histórico ganhou/perdeu entradas. */
  'history:changed': null;
  'trash:changed': null;
  'loadtest:progress': { runId: string; stats: LoadTestStats };
  /** O Claude pede confirmação para uma ação destrutiva. */
  'mcp:confirm': McpConfirmRequest;
  'mcp:confirm-timeout': { id: string };
  /** O Claude alterou algo (aviso discreto). */
  'mcp:notice': { message: string };
  /** Túneis mudaram (status, URL, chamadas recebidas). */
  'tunnel:changed': TunnelView[];
  'tunnel:download': { received: number; total: number | null };
  'db:changed': DbState;
}

export type IpcChannel = keyof IpcContract;
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args'];
export type IpcResult<C extends IpcChannel> = IpcContract[C]['result'];
export type IpcEvent = keyof IpcEvents;

export const IPC_CHANNELS = [
  'app:getInfo',
  'window:setTitleBarColors',
  'settings:get',
  'settings:update',
  'workspace:get',
  'workspace:command',
  'workspace:setActiveEnvironment',
  'workspace:revealInExplorer',
  'secrets:reveal',
  'request:send',
  'request:cancel',
  'dialog:openFiles',
  'import:pickFiles',
  'import:preview',
  'import:run',
  'history:list',
  'history:get',
  'history:remove',
  'history:clear',
  'codegen:generate',
  'export:collection',
  'export:variables',
  'export:csv',
  'export:all',
  'examples:save',
  'loadtest:start',
  'loadtest:cancel',
  'mcp:respond',
  'mcp:setup',
  'mcp:installClaudeDesktop',
  'trash:list',
  'trash:restore',
  'trash:remove',
  'trash:empty',
  'workspace:pickFolder',
  'workspace:inspectFolder',
  'workspace:open',
  'workspace:recent',
  'workspace:forgetRecent',
  'tunnel:list',
  'tunnel:binary',
  'tunnel:install',
  'tunnel:create',
  'tunnel:update',
  'tunnel:remove',
  'tunnel:start',
  'tunnel:stop',
  'tunnel:exchange',
  'tunnel:replay',
  'tunnel:test',
  'tunnel:clear',
  'tunnel:setWebhookSecret',
  'tunnel:simulate',
  'db:state',
  'db:saveConnection',
  'db:duplicateConnection',
  'db:removeConnection',
  'db:saveCredential',
  'db:removeCredential',
  'db:test',
  'db:connect',
  'db:disconnect',
  'db:schema',
  'db:run',
  'db:cancel',
  'db:history',
  'db:clearHistory',
] as const satisfies readonly IpcChannel[];

export const IPC_EVENTS = [
  'workspace:changed',
  'history:changed',
  'trash:changed',
  'loadtest:progress',
  'mcp:confirm',
  'mcp:confirm-timeout',
  'mcp:notice',
  'tunnel:changed',
  'tunnel:download',
  'db:changed',
] as const satisfies readonly IpcEvent[];

// Garante em tempo de compilação que as listas cobrem todo o contrato.
type MissingChannels = Exclude<IpcChannel, (typeof IPC_CHANNELS)[number]>;
type MissingEvents = Exclude<IpcEvent, (typeof IPC_EVENTS)[number]>;
const _allListed: [MissingChannels, MissingEvents] extends [never, never] ? true : false = true;
void _allListed;

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && (IPC_CHANNELS as readonly string[]).includes(value);
}

export function isIpcEvent(value: unknown): value is IpcEvent {
  return typeof value === 'string' && (IPC_EVENTS as readonly string[]).includes(value);
}

/** Prefixo das mensagens de erro dos handlers (o Electron embrulha a mensagem original). */
export const IPC_ERROR_PREFIX = 'ROTA_ERROR:';

/** API exposta pelo preload em `window.api`. */
export interface RendererApi {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>>;
  /** Assina um evento do main; retorna a função para cancelar. */
  on<E extends IpcEvent>(event: E, listener: (payload: IpcEvents[E]) => void): () => void;
  /** Caminho real de um arquivo arrastado (form-data). */
  pathForFile(file: File): string;
}

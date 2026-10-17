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
  HistoryEntry,
  HistorySummary,
  HttpResponse,
  ImportPreview,
  ImportReport,
  PreparedRequest,
  RequestData,
  RunResult,
  Scripts,
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
  | { type: 'updateGlobals'; variables: VariableInput[] };

export interface CommandResult {
  /** Id do item criado/duplicado, quando aplicável. */
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

export interface SaveExampleInput {
  requestId: string;
  name: string;
  request: PreparedRequest | null;
  response: HttpResponse;
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
    args: [query: string, limit: number];
    result: { items: HistorySummary[]; total: number };
  };
  'history:get': { args: [id: string]; result: HistoryEntry | null };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'history:remove': { args: [id: string]; result: void };
  // biome-ignore lint/suspicious/noConfusingVoidType: canal sem retorno
  'history:clear': { args: []; result: void };

  'codegen:generate': { args: [input: CodegenInput]; result: string };
  'examples:save': { args: [input: SaveExampleInput]; result: string };
}

export interface IpcEvents {
  'workspace:changed': WorkspaceState;
  /** O histórico ganhou/perdeu entradas. */
  'history:changed': null;
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
  'examples:save',
] as const satisfies readonly IpcChannel[];

export const IPC_EVENTS = ['workspace:changed', 'history:changed'] as const satisfies readonly IpcEvent[];

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
